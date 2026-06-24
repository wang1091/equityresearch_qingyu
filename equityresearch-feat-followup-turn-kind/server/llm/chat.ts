// Provider-failover layer on top of the OpenAI-compatible chat-completions
// shape. A "chain" is an ordered list of ChatProviders; callChatWithFailover
// tries them in order and, on a failover-worthy error (or empty content from a
// non-final provider), advances to the next one. Every provider normalizes its
// output into the DeepSeekChatResponse shape, so callers parse the result
// identically regardless of which provider answered.
//
// Cancellation: every provider call goes through an AbortScope (observability/
// http abort.ts) that merges the caller's signal (e.g. SSE client-disconnect)
// with a per-attempt timeout, and records WHY it aborted. A client-disconnect
// abort is NOT failover-worthy — the client is gone, so trying the next
// provider would only burn more tokens; an upstream timeout still fails over.
//
// Deliberately lighter than competitive/providers/* (no registry, no
// tagged-union business outcomes, no stamping) — this only does transport +
// failover. Each call site keeps its own parse + degrade policy on top.
//
// Default chain (resolveChatChain): DeepSeek primary, Gemini fallback when
// GEMINI_API_KEY is set. With GEMINI_API_KEY unset the chain is DeepSeek-only.
import { logger } from "../utils";
import { GEMINI_API, DEEPSEEK_API, PERPLEXITY_API } from "../config/providers";
import { getDeepSeekApiKey, type DeepSeekChatResponse } from "./deepseek";
import { createAbortScope, isAbortError } from "../../http/abort";
import { createRequestJson, ApiRequestError } from "../../http/httpClient";
import type { CancellationReason } from "../../shared/cancellation";

// Shared transport for the NON-STREAMING provider calls: routes each attempt
// through http/createRequestJson for a per-host circuit breaker + structured
// wire logging. fetchFn resolves the global fetch at call time so test stubs are
// honored. maxRetries is 0 — same-provider retry is deliberately left to this
// layer's caller (callChatWithFailover fails over to the NEXT provider instead
// of hammering a rate-limited/5xx one), so retry and failover don't compound.
const chatRequestJson = createRequestJson<string>({
  fetchFn: (input, init) => fetch(input, init),
});

const DEFAULT_TIMEOUT_MS = 60000;
const GEMINI_FALLBACK_MODEL = "gemini-2.5-flash";

export type ChatResponse = DeepSeekChatResponse;

export interface ChatRequest {
  messages: Array<{ role: "system" | "user" | "assistant"; content: string }>;
  temperature?: number;
  max_tokens?: number;
  response_format?: { type: "json_object" };
  // ── Perplexity-only search params (ignored by other providers) ──────────────
  // postOpenAiCompatible spreads `...req` into the request body and JSON.stringify
  // drops undefined fields, so these are inert for DeepSeek; geminiChatProvider
  // maps fields explicitly and never reads them. Only set them on a Perplexity call.
  /** "month" | "week" | "day" | "hour" — recency window for web search. */
  search_recency_filter?: string;
  /** Allow/deny-list of domains for web search. */
  search_domain_filter?: string[];
  /** Append Perplexity's suggested follow-up questions to the response. */
  return_related_questions?: boolean;
}

/** Per-attempt transport options threaded to a provider's fetch. */
export interface ChatCallOptions {
  timeoutMs?: number;
  /** External cancellation (e.g. SSE client-disconnect). Merged with the
   *  per-attempt timeout via an AbortScope. */
  signal?: AbortSignal;
}

export interface ChatProvider {
  readonly id: string;
  call(req: ChatRequest, opts?: ChatCallOptions): Promise<ChatResponse>;
  /** Optional real (token-by-token) streaming. Providers without it fall back
   *  to call() in callChatStreamWithFailover (whole content emitted as one
   *  delta). onDelta receives each incremental text chunk; the returned
   *  ChatResponse carries the full accumulated content. */
  callStream?(
    req: ChatRequest,
    onDelta: (delta: string) => void,
    opts?: ChatCallOptions,
  ): Promise<ChatResponse>;
}

/** HTTP-level failure from a chat provider (non-2xx), carrying the status so the
 *  failover logic and callers (e.g. followups' 502 passthrough) can branch. */
export class ChatHttpError extends Error {
  constructor(
    public readonly providerId: string,
    public readonly status: number,
    public readonly body: string,
  ) {
    super(`${providerId} HTTP ${status}: ${body.slice(0, 200)}`);
    this.name = "ChatHttpError";
  }
}

/** A provider call was aborted. `reason` distinguishes a client-disconnect /
 *  client-abort (terminal — do NOT fail over) from a timeout (failover-worthy).*/
export class ChatAbortError extends Error {
  constructor(
    public readonly providerId: string,
    public readonly reason: CancellationReason,
  ) {
    super(`${providerId} aborted (${reason})`);
    this.name = "ChatAbortError";
  }
}

/** The upstream HTTP status of an error, if it carries one (e.g. ChatHttpError
 *  exposes `.status`). Undefined for timeout/transport/local errors. */
export function httpStatusOf(err: unknown): number | undefined {
  if (err && typeof err === "object" && typeof (err as { status?: unknown }).status === "number") {
    return (err as { status: number }).status;
  }
  return undefined;
}

/** Whether an error warrants trying the next provider. Out-of-balance (402),
 *  auth (401/403), rate-limit (429), and server (5xx) errors fail over; a 400
 *  (bad request) fails identically everywhere, so it is terminal. Timeouts and
 *  transport (network) errors fail over too — but a client-disconnect abort does
 *  NOT (the client is gone; the fallback would only burn more tokens). */
export function isFailoverError(err: unknown): boolean {
  if (err instanceof ChatAbortError) {
    // Only a per-attempt upstream timeout is worth trying another provider.
    // A pipeline-timeout (whole-request budget gone) or a client-disconnect is
    // terminal — failing over would just burn more time/tokens for no one.
    return err.reason === "upstream_timeout";
  }
  const status = httpStatusOf(err);
  if (status !== undefined) {
    if (status === 400) return false;
    return status === 401 || status === 402 || status === 403 || status === 429 || status >= 500;
  }
  // A statusless ApiRequestError from the shared transport — CIRCUIT_OPEN (this
  // provider's host is failing fast), NETWORK_ERROR, or TIMEOUT — is a transport
  // failure: try the next provider.
  if (err instanceof ApiRequestError) return true;
  const name = (err as { name?: string } | undefined)?.name;
  if (name === "TimeoutError" || name === "AbortError") return true;
  // fetch() rejects with a TypeError on DNS/network failure.
  if (err instanceof TypeError) return true;
  return false;
}

export interface FailoverResult {
  response: ChatResponse;
  providerId: string;
}

/** Emit token accounting (when the provider returned it) as a structured event.
 *  DeepSeek's prompt-cache split (hit/miss) lets us monitor real cache hit-rate
 *  in prod — the dominant cost lever for the big static classifier prompt. */
function logUsage(providerId: string, response: ChatResponse): void {
  const u = response.usage;
  if (!u) return;
  const hit = u.prompt_cache_hit_tokens;
  const miss = u.prompt_cache_miss_tokens;
  const cacheHitRate =
    typeof hit === "number" && typeof miss === "number" && hit + miss > 0
      ? +(hit / (hit + miss)).toFixed(3)
      : undefined;
  logger.info("chat.usage", {
    provider: providerId,
    promptTokens: u.prompt_tokens,
    completionTokens: u.completion_tokens,
    cacheHitTokens: hit,
    cacheMissTokens: miss,
    cacheHitRate,
  });
}

export async function callChatWithFailover(
  providers: ChatProvider[],
  req: ChatRequest,
  opts?: { timeoutMs?: number; signal?: AbortSignal; shouldFailover?: (err: unknown) => boolean },
): Promise<FailoverResult> {
  if (providers.length === 0) {
    throw new Error("callChatWithFailover: no providers configured");
  }
  const shouldFailover = opts?.shouldFailover ?? isFailoverError;
  const callOpts: ChatCallOptions = { timeoutMs: opts?.timeoutMs, signal: opts?.signal };
  let lastError: unknown;

  for (let i = 0; i < providers.length; i++) {
    const provider = providers[i];
    const isLast = i === providers.length - 1;
    try {
      const response = await provider.call(req, callOpts);
      const content = response.choices?.[0]?.message?.content;
      // Empty content (e.g. Gemini safety block, or DeepSeek under load) is a
      // soft failure: try the next provider, but if this is the last one return
      // it and let the caller's own empty-handling run.
      if (!content && !isLast) {
        logger.warn("chat.failover", {
          from: provider.id,
          to: providers[i + 1].id,
          reason: "empty_content",
        });
        lastError = new Error(`${provider.id} returned empty content`);
        continue;
      }
      logUsage(provider.id, response);
      return { response, providerId: provider.id };
    } catch (err) {
      lastError = err;
      if (!isLast && shouldFailover(err)) {
        logger.warn("chat.failover", {
          from: provider.id,
          to: providers[i + 1].id,
          reason: err instanceof Error ? err.message : String(err),
        });
        continue;
      }
      throw err;
    }
  }
  // Unreachable in practice (the loop returns or throws), but satisfies the type.
  throw lastError;
}

/**
 * Streaming sibling of callChatWithFailover. Emits each token via onDelta and
 * returns the full accumulated response. Failover is only possible BEFORE the
 * first token: once a provider has streamed any output we are committed to it
 * (a partial answer is already on the wire), so a mid-stream error rethrows.
 * Providers without callStream fall back to call() and emit the whole content
 * as a single delta — so a non-streaming fallback (e.g. Gemini) still works,
 * just without token-level streaming on that rarer path.
 */
export async function callChatStreamWithFailover(
  providers: ChatProvider[],
  req: ChatRequest,
  onDelta: (delta: string) => void,
  opts?: { timeoutMs?: number; signal?: AbortSignal; shouldFailover?: (err: unknown) => boolean },
): Promise<FailoverResult> {
  if (providers.length === 0) {
    throw new Error("callChatStreamWithFailover: no providers configured");
  }
  const shouldFailover = opts?.shouldFailover ?? isFailoverError;
  const callOpts: ChatCallOptions = { timeoutMs: opts?.timeoutMs, signal: opts?.signal };
  let lastError: unknown;

  for (let i = 0; i < providers.length; i++) {
    const provider = providers[i];
    const isLast = i === providers.length - 1;
    let emitted = false;
    const guardedOnDelta = (delta: string) => {
      if (delta) {
        emitted = true;
        onDelta(delta);
      }
    };
    try {
      let response: ChatResponse;
      if (provider.callStream) {
        response = await provider.callStream(req, guardedOnDelta, callOpts);
      } else {
        // Non-streaming provider: emit its whole content as one delta.
        response = await provider.call(req, callOpts);
        guardedOnDelta(response.choices?.[0]?.message?.content || "");
      }
      const content = response.choices?.[0]?.message?.content;
      if (!content && !emitted && !isLast) {
        logger.warn("chat.stream.failover", {
          from: provider.id,
          to: providers[i + 1].id,
          reason: "empty_content",
        });
        lastError = new Error(`${provider.id} returned empty content`);
        continue;
      }
      return { response, providerId: provider.id };
    } catch (err) {
      lastError = err;
      // Cannot fail over once tokens are on the wire, or on a terminal error.
      if (emitted || isLast || !shouldFailover(err)) {
        throw err;
      }
      logger.warn("chat.stream.failover", {
        from: provider.id,
        to: providers[i + 1].id,
        reason: err instanceof Error ? err.message : String(err),
        beforeFirstToken: true,
      });
      continue;
    }
  }
  throw lastError;
}

// ─────────────────────────────────────────────
// Provider adapters
// ─────────────────────────────────────────────

/** Build an AbortScope merging the caller's signal with a per-attempt timeout.
 *  A fired external signal is attributed to client_disconnect (terminal); the
 *  timeout to upstream_timeout (failover-worthy). */
function attemptScope(opts?: ChatCallOptions) {
  return createAbortScope({
    externalSignal: opts?.signal,
    externalReason: "client_disconnect",
    timeoutMs: opts?.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    timeoutReason: "upstream_timeout",
  });
}

/** Translate a transport rejection into the chat error types the failover layer
 *  understands. Order matters: the outer AbortScope's reason (when its signal
 *  fired) wins — that is the ONLY place that tells a client_disconnect (terminal)
 *  apart from an upstream_timeout (failover-worthy). An ApiRequestError carrying
 *  an HTTP status becomes a ChatHttpError (so `.status`/`providerId` branch as
 *  before); a statusless one (circuit/network) propagates and isFailoverError
 *  treats it as a transport failure. */
function asChatError(err: unknown, providerId: string, reason: CancellationReason | null): unknown {
  if (isAbortError(err) && reason) {
    return new ChatAbortError(providerId, reason);
  }
  if (err instanceof ApiRequestError && err.status !== undefined) {
    return new ChatHttpError(providerId, err.status, err.message);
  }
  return err;
}

/** Run a non-streaming POST through the shared transport (circuit breaker +
 *  wire logging; no same-provider retry). The caller's outer AbortScope owns the
 *  real timeout/cancellation — we hand its signal down and give createRequestJson
 *  a slightly looser internal timeout as a backstop, so the scope fires first and
 *  its cancellation reason is preserved. */
async function postJsonViaTransport(
  scope: ReturnType<typeof attemptScope>,
  source: string,
  url: string,
  endpointName: string,
  init: RequestInit,
  opts: ChatCallOptions | undefined,
): Promise<unknown> {
  return chatRequestJson({
    source,
    request: { url, endpointName, init: { ...init, signal: scope.signal } },
    policy: {
      timeoutMs: (opts?.timeoutMs ?? DEFAULT_TIMEOUT_MS) + 10_000,
      maxRetries: 0,
      circuitBreaker: true,
      circuitFailureThreshold: 3,
      circuitOpenMs: 30_000,
    },
  });
}

/** POST an OpenAI-compatible /chat/completions (non-streaming). */
async function postOpenAiCompatible(
  baseUrl: string,
  apiKey: string,
  model: string,
  providerId: string,
  req: ChatRequest,
  opts?: ChatCallOptions,
): Promise<ChatResponse> {
  const scope = attemptScope(opts);
  try {
    return (await postJsonViaTransport(
      scope,
      providerId,
      `${baseUrl}/chat/completions`,
      "chat/completions",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
        },
        body: JSON.stringify({ model, ...req }),
      },
      opts,
    )) as ChatResponse;
  } catch (err) {
    throw asChatError(err, providerId, scope.getCancellationReason());
  } finally {
    scope.cleanup();
  }
}

/** Read an OpenAI-compatible SSE stream, invoking onDelta per token and
 *  returning the full accumulated content. */
async function streamOpenAiCompatible(
  baseUrl: string,
  apiKey: string,
  model: string,
  providerId: string,
  req: ChatRequest,
  onDelta: (delta: string) => void,
  opts?: ChatCallOptions,
): Promise<ChatResponse> {
  const scope = attemptScope(opts);
  try {
    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
      },
      signal: scope.signal,
      body: JSON.stringify({ model, ...req, stream: true }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new ChatHttpError(providerId, res.status, body);
    }

    const reader = res.body?.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let full = "";
    let finish_reason: string | undefined;

    const handleLine = (line: string) => {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) return;
      const payload = trimmed.slice(5).trim();
      if (!payload || payload === "[DONE]") return;
      try {
        const parsed = JSON.parse(payload);
        const choice = parsed.choices?.[0];
        if (choice?.finish_reason) finish_reason = choice.finish_reason;
        const delta = choice?.delta?.content || "";
        if (delta) {
          full += delta;
          onDelta(delta);
        }
      } catch {
        // Partial/!JSON frame — ignore; the next read completes it.
      }
    };

    if (reader) {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";
        for (const line of lines) handleLine(line);
      }
      buffer += decoder.decode();
      if (buffer) handleLine(buffer);
    }

    return { choices: [{ message: { content: full }, finish_reason }] };
  } catch (err) {
    throw asChatError(err, providerId, scope.getCancellationReason());
  } finally {
    scope.cleanup();
  }
}

/** DeepSeek over its OpenAI-compatible endpoint. */
export function deepSeekChatProvider(apiKey: string, model: string): ChatProvider {
  return {
    id: "deepseek",
    call: (req, opts) => postOpenAiCompatible(DEEPSEEK_API, apiKey, model, "deepseek", req, opts),
    callStream: (req, onDelta, opts) =>
      streamOpenAiCompatible(DEEPSEEK_API, apiKey, model, "deepseek", req, onDelta, opts),
  };
}

/** Any OpenAI-compatible /chat/completions endpoint (DeepSeek, a local
 *  Ollama/vLLM, ...). Used by the classifier, whose base URL is env-overridable.
 *  apiKey may be empty for a keyless local server. */
export function openAiCompatibleChatProvider(
  baseUrl: string,
  apiKey: string,
  model: string,
  id = "llm",
): ChatProvider {
  return {
    id,
    call: (req, opts) => postOpenAiCompatible(baseUrl, apiKey, model, id, req, opts),
    callStream: (req, onDelta, opts) =>
      streamOpenAiCompatible(baseUrl, apiKey, model, id, req, onDelta, opts),
  };
}

/** Perplexity over its OpenAI-compatible /chat/completions endpoint. Adds web
 *  search; its top-level `citations` flows through ChatResponse unchanged.
 *
 *  No callStream on purpose: streamOpenAiCompatible reconstructs only
 *  {choices:[…]} and would DROP citations, so callChatStreamWithFailover falls
 *  back to call() (whole content as one delta) and preserves them. These call
 *  sites (qa, recommend) are non-streaming anyway. */
export function perplexityChatProvider(apiKey: string, model = "sonar"): ChatProvider {
  return {
    id: "perplexity",
    call: (req, opts) => postOpenAiCompatible(PERPLEXITY_API, apiKey, model, "perplexity", req, opts),
  };
}

/** POST Gemini's generateContent, mapping the chat-completions request in and
 *  the response back. `googleSearch` adds the live-web-search grounding tool;
 *  it is incompatible with responseMimeType:application/json, so JSON mode is
 *  only honored when NOT searching. */
async function postGemini(
  apiKey: string,
  model: string,
  req: ChatRequest,
  opts: ChatCallOptions | undefined,
  googleSearch: boolean,
): Promise<ChatResponse> {
  const systemText = req.messages
    .filter((m) => m.role === "system")
    .map((m) => m.content)
    .join("\n\n");
  const contents = req.messages
    .filter((m) => m.role !== "system")
    .map((m) => ({
      role: m.role === "assistant" ? "model" : "user",
      parts: [{ text: m.content }],
    }));

  const generationConfig: Record<string, unknown> = {};
  if (req.temperature !== undefined) generationConfig.temperature = req.temperature;
  if (req.max_tokens !== undefined) generationConfig.maxOutputTokens = req.max_tokens;
  // Gemini's equivalent of DeepSeek's response_format:{type:"json_object"} —
  // mutually exclusive with the google_search tool, so skip it when searching.
  if (!googleSearch && req.response_format?.type === "json_object") {
    generationConfig.responseMimeType = "application/json";
  }

  const body: Record<string, unknown> = { contents, generationConfig };
  if (systemText) body.systemInstruction = { parts: [{ text: systemText }] };
  if (googleSearch) body.tools = [{ google_search: {} }];

  const scope = attemptScope(opts);
  try {
    const data = (await postJsonViaTransport(
      scope,
      "gemini",
      `${GEMINI_API}/v1beta/models/${model}:generateContent?key=${apiKey}`,
      "generateContent",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      },
      opts,
    )) as {
      candidates?: Array<{
        content?: { parts?: Array<{ text?: string }> };
        finishReason?: string;
      }>;
    };
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
    const geminiReason = data.candidates?.[0]?.finishReason;
    // Map Gemini's MAX_TOKENS to the OpenAI "length" sentinel some callers
    // (e.g. translation/json) check to detect truncation.
    const finish_reason = geminiReason === "MAX_TOKENS" ? "length" : geminiReason;
    return { choices: [{ message: { content: text }, finish_reason }] };
  } catch (err) {
    throw asChatError(err, "gemini", scope.getCancellationReason());
  } finally {
    scope.cleanup();
  }
}

/** Gemini (NOT OpenAI-compatible) for generation/routing tasks. No google_search
 *  tool, so JSON mode (response_format) is honored. */
export function geminiChatProvider(apiKey: string, model: string = GEMINI_FALLBACK_MODEL): ChatProvider {
  return {
    id: "gemini",
    call: (req, opts) => postGemini(apiKey, model, req, opts, false),
  };
}

/** Gemini with Google Search grounding — for the live-web-search fallback. Emits
 *  free text (JSON mode is unavailable alongside the tool); callers parse the
 *  text themselves. */
export function geminiSearchProvider(apiKey: string, model: string = GEMINI_FALLBACK_MODEL): ChatProvider {
  return {
    id: "gemini",
    call: (req, opts) => postGemini(apiKey, model, req, opts, true),
  };
}

/** Default chat chain: DeepSeek primary + Gemini fallback (only when
 *  GEMINI_API_KEY is set). Used by the non-streaming route call sites. */
export function resolveChatChain(): ChatProvider[] {
  const chain: ChatProvider[] = [];
  // Optional LOCAL-FIRST override: when an OpenAI-compatible base is configured
  // (CHAT_LLM_BASE_URL, else the shared LLM_BASE_URL alias) the whole generation
  // path can run on a local model (Ollama / LM Studio / vLLM) — mirrors the
  // classifier (resolveClassifierLlm) and the data upstreams' local-primary +
  // public-fallback pattern. It goes FIRST so DeepSeek/Gemini below remain as
  // failover. When unset the chain is unchanged (DeepSeek primary, Gemini fallback).
  const localBase = (process.env.CHAT_LLM_BASE_URL || process.env.LLM_BASE_URL || "")
    .trim()
    .replace(/\/+$/, "");
  if (localBase) {
    const localModel = process.env.CHAT_LLM_MODEL || process.env.LLM_MODEL || "local-model";
    const localKey = process.env.CHAT_LLM_API_KEY || process.env.LLM_API_KEY || "";
    chain.push(openAiCompatibleChatProvider(localBase, localKey, localModel, "local-llm"));
  }
  const deepSeekKey = getDeepSeekApiKey();
  if (deepSeekKey) chain.push(deepSeekChatProvider(deepSeekKey, "deepseek-chat"));
  const geminiKey = process.env.GEMINI_API_KEY;
  if (geminiKey) chain.push(geminiChatProvider(geminiKey));
  return chain;
}
