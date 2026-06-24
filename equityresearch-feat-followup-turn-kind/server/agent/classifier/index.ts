// server/agent/classifier/index.ts
//
// LLM-first intent classifier. Extracted from the /api/classify-intents-multi
// route handler so it can be called in-process (no localhost HTTP loopback).
// This file is just the orchestrator; the heavy pieces live alongside it:
//   - prompt.ts    — the DeepSeek system prompt (routing guide + examples)
//   - normalize.ts — keyword fallback + deterministic post-processing
//   - types.ts     — shared types
import { jsonrepair } from "jsonrepair";
import { cleanJsonResponse, logger } from "../../utils";
import { DEEPSEEK_API } from "../../config/providers";
import { easternToday, easternTomorrow } from "../../../shared/earnings";
import { validateClassifierOutput } from "./schema";
import {
  callChatWithFailover,
  openAiCompatibleChatProvider,
  geminiChatProvider,
  type ChatProvider,
} from "../../llm/chat";
import { buildClassifierSystemPrompt } from "./prompt";
import {
  buildKeywordFallback,
  normalizeClassifierResult,
} from "./normalize";
import { formatHistoryAsText } from "../../llm/history";
import type {
  ClassificationResult,
  ConversationTurn,
} from "./types";

export type { ClassificationResult, ConversationTurn } from "./types";
export { buildKeywordFallback } from "./normalize";

// History window for the classifier. It uses history for pronoun resolution /
// ticker carry-forward (see docs/LLM_HISTORY_CONTEXT_PLAN.md), so the window is
// deliberately small — but NOT user-only: the assistant's answers often INTRODUCE
// the entity the user then refers to ("which stocks are undervalued?" → answer
// lists INTC/F → "the first one's valuation?"). Dropping assistant turns made
// those references unresolvable, so both roles are kept. The per-turn cap bounds
// the (long) assistant briefs while still catching the headline ticker.
//
// Carry-forward depth: when the assistant's answers DON'T restate the ticker, an
// explicitly-named ticker survives ⌊WINDOW/2⌋ pronoun-only follow-ups (each turn
// adds a user+assistant pair). WINDOW=6 → 3 hops is the floor; real answers that
// restate the ticker carry it further. (classifierHistory.test.ts pins this.)
const CLASSIFIER_HISTORY_WINDOW = 6; // last N messages (≈3 turns)
const CLASSIFIER_HISTORY_MAX_CHARS = 400; // per-turn cap (catches headline tickers in assistant briefs)

/**
 * Classifier LLM endpoint. The request/response is OpenAI-compatible (so is
 * DeepSeek, the default), which means any OpenAI-compatible server can be
 * registered by env — including a LOCAL model (Ollama / LM Studio / vLLM) to
 * run the routing suite for free. Defaults reproduce the old hardcoded
 * DeepSeek behaviour exactly, so leaving the env unset changes nothing.
 *
 *   CLASSIFIER_LLM_BASE_URL  e.g. http://localhost:11434/v1   (Ollama)
 *   CLASSIFIER_LLM_MODEL     e.g. qwen2.5:14b
 *   CLASSIFIER_LLM_API_KEY   optional for local servers
 *
 * NOTE: a smaller local model usually routes worse than DeepSeek — use it for
 * cheap iteration, but gate the LLM-first deletions (A2–A8) on a DeepSeek run.
 */
export function resolveClassifierLlm() {
  const baseUrl = (
    process.env.CLASSIFIER_LLM_BASE_URL ||
    process.env.LLM_BASE_URL ||
    DEEPSEEK_API
  ).replace(/\/+$/, "");
  const model =
    process.env.CLASSIFIER_LLM_MODEL || process.env.LLM_MODEL || "deepseek-chat";
  const apiKey =
    process.env.CLASSIFIER_LLM_API_KEY ||
    process.env.LLM_API_KEY ||
    process.env.DEEPSEEK_API_KEY ||
    process.env.DEEPSEEK_KEY ||
    "";
  // Output cap (NOT context window). The classifier JSON is small, so 600 is
  // plenty for DeepSeek; bump it for a local reasoning model that thinks before
  // emitting the JSON. Invalid/empty → default 600.
  const maxTokens =
    Number(process.env.CLASSIFIER_LLM_MAX_TOKENS || process.env.LLM_MAX_TOKENS) || 1000;
  // Abort budget. 15s is fine for hosted DeepSeek; a local model on CPU/consumer
  // GPU needs much more (a 9B model takes ~10-20s on the full classifier prompt),
  // so make it overridable. Invalid/empty → default 15000.
  const timeoutMs =
    Number(process.env.CLASSIFIER_LLM_TIMEOUT_MS || process.env.LLM_TIMEOUT_MS) || 15000;
  // Only the hosted DeepSeek default actually requires a key; a custom endpoint
  // (typically a local server) may legitimately run keyless.
  const isDefaultDeepSeek = baseUrl === DEEPSEEK_API;
  return { baseUrl, model, apiKey, maxTokens, timeoutMs, isDefaultDeepSeek };
}

export async function classifyIntents(
  query: string,
  conversationHistory: ConversationTurn[] = [],
  language: "en" | "zh" = "en",
): Promise<ClassificationResult> {
  const llm = resolveClassifierLlm();
  if (!llm.apiKey && llm.isDefaultDeepSeek) {
    logger.warn("classifier.fallback", { cause: "no_key" });
    return buildKeywordFallback(query);
  }

  const responseLanguage = language === "zh" ? "zh" : "en";
  const outputLanguageLabel = responseLanguage === "zh" ? "中文" : "English";
  const historyContext = formatHistoryAsText(
    conversationHistory.slice(-CLASSIFIER_HISTORY_WINDOW),
    {
      labels:
        responseLanguage === "zh"
          ? { user: "用户", assistant: "助手" }
          : { user: "User", assistant: "Assistant" },
      maxChars: CLASSIFIER_HISTORY_MAX_CHARS,
    },
  );

  // 动态生成时间上下文 — anchored to US Eastern (ET), the standard basis for US
  // equity earnings (so "today/tomorrow/Qn" line up with the ET earnings data).
  const dateString = easternToday();
  const tomorrowIso = easternTomorrow();
  const [currentYear, currentMonth] = dateString.split("-").map(Number);
  const currentQuarter = Math.ceil(currentMonth / 3);
  const lastQuarter = currentQuarter > 1 ? currentQuarter - 1 : 4;
  const lastQuarterYear = currentQuarter > 1 ? currentYear : currentYear - 1;

  const systemPrompt = buildClassifierSystemPrompt({
    outputLanguageLabel,
    historyContext,
    dateString,
    currentYear,
    currentQuarter,
    lastQuarter,
    lastQuarterYear,
    tomorrowIso,
  });

  // Provider chain: the (env-overridable) primary LLM, plus Gemini as a failover
  // when GEMINI_API_KEY is set. The keyword fallback below remains the FINAL
  // safety net after every provider fails.
  const providers: ChatProvider[] = [
    openAiCompatibleChatProvider(
      llm.baseUrl,
      llm.apiKey,
      llm.model,
      llm.isDefaultDeepSeek ? "deepseek" : "classifier-llm",
    ),
  ];
  const geminiKey = process.env.GEMINI_API_KEY;
  if (geminiKey) providers.push(geminiChatProvider(geminiKey));

  // History is injected ONCE — inside the system prompt's CONVERSATION CONTEXT
  // block (buildClassifierSystemPrompt), which also carries the pronoun-resolution
  // rule. Do NOT also echo it as a separate message here (that was a duplicate:
  // same historyContext, twice, see docs/LLM_HISTORY_CONTEXT_PLAN.md A1).
  const messages = [
    { role: "system" as const, content: systemPrompt },
    {
      role: "user" as const,
      content:
        responseLanguage === "zh"
          ? `分类: "${query}"`
          : `Classify this request: "${query}"`,
    },
  ];

  logger.debug(
    `🎯 调用意图分类 LLM (${llm.model} @ ${llm.baseUrl}, 超时:${llm.timeoutMs}ms${providers.length > 1 ? ", +gemini 兜底" : ""})`,
  );

  // JSON mode (response_format:{json_object}) is NOT portable: hosted DeepSeek
  // requires it for reliable JSON, Gemini maps it to responseMimeType, but some
  // OpenAI-compatible servers (observed: an LM Studio build) reject json_object
  // with HTTP 400 ("must be 'json_schema' or 'text'"). So default it ON only for
  // the hosted-DeepSeek endpoint and OFF for custom/local endpoints; an explicit
  // CLASSIFIER_LLM_JSON_MODE=true/false always wins. Provider-agnostic robustness
  // comes from the jsonrepair + zod passes below, not from this flag.
  const jsonModeEnv = process.env.CLASSIFIER_LLM_JSON_MODE;
  const jsonMode =
    jsonModeEnv === "true" ? true : jsonModeEnv === "false" ? false : llm.isDefaultDeepSeek;

  let content: string | undefined;
  try {
    const { response, providerId } = await callChatWithFailover(
      providers,
      {
        temperature: 0,
        max_tokens: llm.maxTokens,
        messages,
        ...(jsonMode ? { response_format: { type: "json_object" as const } } : {}),
      },
      { timeoutMs: llm.timeoutMs },
    );
    if (providerId !== providers[0].id) {
      logger.warn("classifier.failover", { to: providerId });
    }
    content = response.choices?.[0]?.message?.content;
  } catch (err) {
    logger.warn("classifier.fallback", {
      cause: "llm_failed",
      reason: err instanceof Error ? err.message : String(err),
    });
    return buildKeywordFallback(query);
  }

  if (!content) {
    logger.warn("classifier.fallback", { cause: "empty" });
    return buildKeywordFallback(query);
  }

  let result;
  const cleaned = cleanJsonResponse(content);
  try {
    result = JSON.parse(cleaned);
  } catch {
    // Recover common LLM JSON malformations (trailing commas, truncation, an
    // unquoted key) before giving up — mirrors the generator's jsonrepair pass.
    // This keeps a usable-but-slightly-malformed response OUT of the keyword
    // fallback (which would silently drop multi-intent — see bug 005).
    try {
      result = JSON.parse(jsonrepair(cleaned));
      logger.warn("classifier.json_repaired", {});
    } catch (parseError) {
      logger.error("classifier.fallback", {
        cause: "parse_error",
        reason: parseError instanceof Error ? parseError.message : String(parseError),
      });
      return {
        ...buildKeywordFallback(query),
        confidence: 0.3,
        reasoning:
          responseLanguage === "zh"
            ? "降级处理：JSON 解析失败，已改用关键词识别"
            : "Fallback: JSON parse failed, using keyword detection",
      };
    }
  }

  // Structural contract check — observability only, NOT a gate (normalize coerces).
  const schemaCheck = validateClassifierOutput(result);
  if (!schemaCheck.ok) {
    logger.warn("classifier.schema_mismatch", { issues: schemaCheck.issues });
  }

  return normalizeClassifierResult(result, { query, dateString });
}
