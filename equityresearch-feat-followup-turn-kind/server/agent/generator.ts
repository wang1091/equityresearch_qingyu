// 回答生成模块 - Checkit Analytics (Refactored)
import { jsonrepair } from "jsonrepair";
import { logger } from "../utils";
import { getNewsApiBase } from "../upstreamConfig";
import { simplifyApiData } from "./simplify";
import { getSystemPrompt, getSimpleSystemPrompt, getUnifiedPrompt, META_SEPARATOR } from "./generatorPrompts";
import { type AnswerIntent, intentWantsVerdict } from "./answerIntent";
import { canonicalizeStructured, validateStructuredOutput } from "./structuredOutput";
import { buildSources, buildCitedData, enrichNewsCitations, type Source, type Citation } from "./provenance";
import { formatDataAsCard } from "./cardFormatter";
import {
  callChatWithFailover,
  callChatStreamWithFailover,
  resolveChatChain,
} from "../llm/chat";
import { runGeminiFallbackAnalysis } from "../routes/gemini";

// Last-resort fallback when DeepSeek is unavailable (401/402). Calls the shared
// Gemini-Search → Perplexity chain directly (was an HTTP self-proxy to
// /api/gemini-fallback — same logic, no localhost round-trip).
async function tryGeminiFallback(query: string, language: string): Promise<string | null> {
  return runGeminiFallbackAnalysis(query, language === "zh");
}

const SMART_BRIEF_TIMEOUT_MS = 150000;
const SMART_BRIEF_ERROR_BODY_LIMIT = 1000;

interface Message {
  role: "system" | "user" | "assistant";
  content: string;
}

// ─────────────────────────────────────────────
// POST-PROCESS: Sanitize any leaked Markdown
// ─────────────────────────────────────────────

/**
 * Recursively walk a parsed JSON object and clean Markdown
 * artifacts from all string values.
 */
function sanitizeMarkdown(obj: any): any {
  if (typeof obj === "string") {
    return obj
      // Remove heading markers
      .replace(/^#{1,6}\s+/gm, "")
      // Bold (**text** or __text__) → <strong>
      .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
      .replace(/__(.+?)__/g, "<strong>$1</strong>")
      // Italic (*text* or _text_) → remove markers
      .replace(/\*(.+?)\*/g, "$1")
      .replace(/_(.+?)_/g, "$1")
      // Unordered list items (- item or * item) → inline with <br>
      .replace(/^[\-\*]\s+/gm, "• ")
      // Numbered list items
      .replace(/^\d+\.\s+/gm, "")
      .trim();
  }
  if (Array.isArray(obj)) return obj.map(sanitizeMarkdown);
  if (obj !== null && typeof obj === "object") {
    const cleaned: Record<string, any> = {};
    for (const key of Object.keys(obj)) {
      cleaned[key] = sanitizeMarkdown(obj[key]);
    }
    return cleaned;
  }
  return obj;
}

/**
 * Attempt lightweight repair of common LLM JSON malformations:
 * - Missing closing quote + comma before the next key
 *   e.g.  "conviction": "LOW "price_target": "N/A"
 *       → "conviction": "LOW ", "price_target": "N/A"
 * - Trailing commas before } or ]
 * - Truncated JSON (close all open braces/brackets)
 */
function repairJson(str: string): string {
  let s = str;

  // Fix: closing-quote-of-value consumed as start of next bare key.
  // Pattern: "WORD": where the char before " is a string char (no preceding comma/brace).
  // Replace "WORD": → ", "WORD":  (re-inserting the closing quote + adding comma)
  s = s.replace(/"([a-zA-Z_][a-zA-Z0-9_]*)("(\s*):)/g, (match, word, rest, _sp, offset, full) => {
    const prevChars = full.slice(Math.max(0, offset - 15), offset);
    const lastSep = Math.max(
      prevChars.lastIndexOf(','),
      prevChars.lastIndexOf('{'),
      prevChars.lastIndexOf('['),
    );
    const lastQuote = prevChars.lastIndexOf('"');
    // If a closing quote is more recent than any separator, we're in the broken case
    if (lastQuote > lastSep) {
      return '", "' + word + rest;
    }
    return match;
  });

  // Remove trailing commas before } or ]
  s = s.replace(/,(\s*[}\]])/g, '$1');

  // Close any unclosed braces/brackets by counting
  const opens = (s.match(/\{/g) || []).length;
  const closes = (s.match(/\}/g) || []).length;
  const arrOpens = (s.match(/\[/g) || []).length;
  const arrCloses = (s.match(/\]/g) || []).length;
  s += ']'.repeat(Math.max(0, arrOpens - arrCloses));
  s += '}'.repeat(Math.max(0, opens - closes));

  return s;
}

/** First balanced `{...}` using string-aware scan (avoids greedy /\{[\s\S]*\}/ breaking on inner `}`). */
function extractFirstJsonObject(str: string): string | null {
  const start = str.indexOf("{");
  if (start < 0) return null;
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < str.length; i++) {
    const c = str[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === "\\") esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') {
      inStr = true;
      continue;
    }
    if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth === 0) return str.slice(start, i + 1);
    }
  }
  return null;
}

/**
 * Parse raw LLM output into a clean JSON object.
 * Handles markdown fences, extraction of the first {...} block,
 * and lightweight JSON repair for common LLM malformations.
 */
export function parseStructuredOutput(raw: string): Record<string, any> | null {
  // Strip markdown code fences if present
  const fenceMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  const jsonStr = fenceMatch ? fenceMatch[1].trim() : raw.trim();

  // Attempt 1: parse as-is
  try {
    const parsed = JSON.parse(jsonStr);
    return sanitizeMarkdown(parsed);
  } catch { /* fall through */ }

  // Attempt 2: extract first balanced {...} block (greedy regex breaks on `}` inside strings)
  const candidate = extractFirstJsonObject(jsonStr) ?? jsonStr;

  try {
    const parsed = JSON.parse(candidate);
    return sanitizeMarkdown(parsed);
  } catch { /* fall through */ }

  // Attempt 3: repair then parse
  try {
    const repaired = repairJson(candidate);
    const parsed = JSON.parse(repaired);
    return sanitizeMarkdown(parsed);
  } catch {
    /* fall through */
  }

  // Attempt 4: jsonrepair (handles many LLM-invalid JSON cases)
  try {
    const repaired = jsonrepair(candidate);
    const parsed = JSON.parse(repaired);
    return sanitizeMarkdown(parsed);
  } catch {
    return null;
  }
}

function normalizeSseLine(line: string): string {
  return line.endsWith("\r") ? line.slice(0, -1) : line;
}

export function splitSseLines(input: string): { lines: string[]; remainder: string } {
  const parts = input.split("\n");
  const remainder = parts.pop() ?? "";
  return {
    lines: parts.map(normalizeSseLine),
    remainder,
  };
}

/** Pick the array element for a (ticker/company), or the sole/first element. */
function matchElement(data: any, ticker?: string | null): any {
  if (data == null) return undefined;
  const elements = Array.isArray(data) ? data : [data];
  if (!ticker) return elements[0];
  return elements.find((e: any) => e?.ticker === ticker || e?.company === ticker) ?? elements[0];
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * Compact key/value card for sources with no dedicated formatter (e.g.
 * PEER_STOCKS). Built from the SIMPLIFIED element: primitive fields as rows,
 * arrays summarized by count + a few labels. Nested objects are skipped.
 */
function genericMiniCard(provider: string, el: any, language: "en" | "zh"): string | null {
  if (!el || typeof el !== "object") return null;
  const rows: string[] = [];
  for (const [k, v] of Object.entries(el)) {
    if (v == null) continue;
    let val: string;
    if (Array.isArray(v)) {
      const labels = v
        .map((x: any) => (typeof x === "string" || typeof x === "number" ? String(x) : x?.symbol || x?.ticker || x?.name))
        .filter(Boolean);
      val = `${v.length} ${language === "zh" ? "项" : "items"}`;
      if (labels.length) val += `: ${escapeHtml(labels.slice(0, 8).join(", "))}`;
    } else if (typeof v === "object") {
      continue;
    } else {
      val = escapeHtml(String(v));
    }
    rows.push(
      `<tr><td style="padding:4px 8px;color:#6b7280;font-size:12px;white-space:nowrap;">${escapeHtml(k)}</td><td style="padding:4px 8px;font-size:12px;">${val}</td></tr>`,
    );
  }
  if (rows.length === 0) return null;
  return `<div style="padding:8px;"><div style="font-weight:600;font-size:13px;margin-bottom:4px;">${escapeHtml(provider)}</div><table style="border-collapse:collapse;">${rows.join("")}</table></div>`;
}

/**
 * Render the drill-down card for each card-backed (non-link) source, keyed by its
 * id, by reusing the single-intent direct-card formatters on the RAW payload. The
 * chip in the fused answer can then expand its own card. Link sources are skipped
 * — they already open their URL. Multi-ticker arrays are matched by ticker/company.
 * Sources with no dedicated formatter fall back to a generic mini-card built from
 * the simplified data.
 */
function buildSourceCards(
  apiData: Record<string, any> | null,
  validData: Record<string, any>,
  sources: Source[],
  language: "en" | "zh",
): Record<string, string> {
  const cards: Record<string, string> = {};
  if (!apiData) return cards;
  for (const s of sources) {
    if (s.type === "link") continue;
    const raw = matchElement(apiData[s.provider], s.ticker);
    const html =
      (raw != null ? formatDataAsCard(s.provider, raw, language) : null) ??
      genericMiniCard(s.provider, matchElement(validData[s.provider], s.ticker), language);
    if (html) cards[s.id] = html;
  }
  return cards;
}

// ─────────────────────────────────────────────
// MAIN STREAM FUNCTION
// ─────────────────────────────────────────────

export async function generateAnswerStream(
  userQuery: string,
  apiData: Record<string, any> | null,
  conversationHistory: Message[] = [],
  onChunk: (chunk: string) => void,
  language: "en" | "zh" = "en",
  specialMode?: { type: string; context?: any },
  signal?: AbortSignal,
): Promise<string> {
  logger.info(`🤖 Starting stream generation (lang: ${language}, mode: ${specialMode?.type || "normal"})`);

  // NEWS_BRIEF special path
  if (specialMode?.type === "NEWS_BRIEF" && specialMode.context) {
    const briefJson = await generateNewsBrief(specialMode.context, language);
    onChunk(briefJson);
    return briefJson;
  }

  // SIMPLE prose path — used for factual / lookup questions that don't warrant
  // the multi-module Investment Brief template. Streams raw Markdown chunks.
  if (specialMode?.type === "SIMPLE") {
    const generalKnowledgeOnly = Boolean(
      specialMode.context && specialMode.context.generalKnowledgeOnly,
    );
    return generateSimpleAnswerStream(
      userQuery,
      apiData,
      conversationHistory,
      onChunk,
      language,
      generalKnowledgeOnly,
      signal,
    );
  }

  const systemPrompt = getSystemPrompt(language);

  const isRefinement = specialMode?.type === "REFINE";
  let userContent = isRefinement
    ? (language === "zh"
        ? `用户对上一次回答不满意，请重新分析。要求：重新评估假设、补充遗漏的数据视角、提升推理精度、精简冗余内容。\n\n原始问题：${userQuery}\n\n`
        : `The user rated the previous response as unhelpful. Please re-analyze with improved reasoning: re-evaluate assumptions, check for missing data angles, increase precision, reduce verbosity.\n\nOriginal question: ${userQuery}\n\n`)
    : `User Question: ${userQuery}\n\n`;

  let retrievedSourceKeys: string[] = [];
  // Real, verifiable sources derived TS-side from the retrieved data (NEWS → links,
  // others → provider chips). Attached to the structured output below so the client
  // renders true citations instead of the LLM's free-text guesses.
  let resolvedSources: Source[] = [];
  // Simplified per-source data, kept for the generic mini-card fallback below.
  let resolvedValidData: Record<string, any> = {};
  if (apiData && Object.keys(apiData).length > 0) {
    const simplifiedData = simplifyApiData(apiData);
    // Filter out failed data sources before passing to LLM
    const validData = Object.fromEntries(
      Object.entries(simplifiedData).filter(([, data]) => data && !data.error)
    );
    // Successfully-retrieved sources — the baseline for the fabrication check below.
    retrievedSourceKeys = Object.keys(validData);
    resolvedSources = buildSources(validData);
    resolvedValidData = validData;
    if (Object.keys(validData).length > 0) {
      userContent += `Available Data (freshly retrieved — these figures are authoritative and supersede any numbers from prior conversation history):\n`;
      for (const [source, data] of Object.entries(validData)) {
        userContent += `\n【${source}】\n`;
        userContent += JSON.stringify(data, null, 2);
        userContent += "\n";
      }
      if (validData.EARNINGS?.topic === "calendar") {
        userContent +=
          language === "zh"
            ? "\n（重要：EARNINGS 为 Nasdaq 财报日历，已包含公司列表。必须在分析中列出这些公司；不得声称缺少数据源或要求用户自行接入 API。）\n"
            : "\n(Important: EARNINGS is a Nasdaq earnings calendar; the company list is already provided. You MUST summarize those names/tickers in the Earnings Specialist module and evidence. Do NOT claim data is unavailable or ask the user to enable a separate API.)\n";
      }
    } else {
      userContent += `(No external data available — answer based on financial knowledge, mark all modules as INCONCLUSIVE where data is required)`;
    }
  } else {
    userContent += `(No external data available — answer based on financial knowledge, mark all modules as INCONCLUSIVE where data is required)`;
  }

  const messages: Message[] = [
    { role: "system", content: systemPrompt },
    ...conversationHistory.slice(-10),
    { role: "user", content: userContent },
  ];

  try {
    // The structured brief is buffered anyway (the JSON must be complete before
    // it can be parsed/validated/rendered), so it goes through the non-streaming
    // failover chain: DeepSeek primary, Gemini fallback (when GEMINI_API_KEY is
    // set). The per-token streaming path is generateSimpleAnswerStream below.
    const chain = resolveChatChain();
    if (chain.length === 0) {
      throw new Error("DeepSeek API key not configured");
    }

    let rawOutput = "";
    try {
      const { response, providerId } = await callChatWithFailover(
        chain,
        { messages, temperature: 0.3, max_tokens: 4000 },
        { signal },
      );
      if (providerId !== chain[0].id) {
        logger.warn("generator.failover", { to: providerId });
      }
      rawOutput = response.choices?.[0]?.message?.content || "";
    } catch (llmError) {
      // Whole chain failed — last-resort equity-research HTML fallback
      // (Gemini Search / Perplexity via /api/gemini-fallback).
      logger.warn("generator.fallback", {
        cause: "chain_failed",
        reason: llmError instanceof Error ? llmError.message : String(llmError),
      });
      const fallback = await tryGeminiFallback(userQuery, language);
      if (fallback) { onChunk(fallback); return fallback; }
      throw llmError;
    }

    // Parse and sanitize output
    const structured = parseStructuredOutput(rawOutput);

    if (structured) {
      // Pin the canonical contract + run lightweight anti-fabrication checks.
      canonicalizeStructured(structured);
      // Attach the TS-derived sources + their drill-down cards (schema is
      // .passthrough(), so these survive). Cards are keyed by source id.
      if (resolvedSources.length > 0) {
        structured.sources = resolvedSources;
        const cards = buildSourceCards(apiData, resolvedValidData, resolvedSources, language);
        if (Object.keys(cards).length > 0) structured.source_cards = cards;
      }
      const warnings = validateStructuredOutput(structured, retrievedSourceKeys);
      if (warnings.length) {
        logger.warn(`⚠️ structured output validation: ${warnings.join("; ")}`);
      }
      const finalJson = JSON.stringify(structured);
      onChunk(finalJson);
      logger.success("✅ Structured output generated and sanitized");
      return finalJson;
    } else {
      // Fallback: send raw output (frontend should handle gracefully)
      logger.warn("generator.fallback", {
        cause: "parse_raw",
        rawLength: rawOutput.length,
        preview: rawOutput.slice(0, 60),
      });
      onChunk(rawOutput);
      return rawOutput;
    }
  } catch (error) {
    logger.error("❌ Stream generation failed:", error);
    throw error;
  }
}

// ─────────────────────────────────────────────
// UNIFIED ANSWER (merge of SIMPLE + Brief) — flag-gated, see index.ts
// ─────────────────────────────────────────────

export interface UnifiedAnswer {
  body: string; // markdown, with [S{n}] inline citation markers
  verdict?: { stance: string; conviction?: string; priceTarget?: string };
  citations: Citation[]; // numbered blocks the [S{n}] markers point to
  source_cards?: Record<string, string>;
  notice?: string; // degraded-answer banner when requested sources failed
}

/** "STOCK_PRICE" → "stock price" for the fallback notice. */
function prettySource(s: string): string {
  return s.replace(/_/g, " ").toLowerCase();
}

type DegradeKind = "unavailable" | "retryable";

/**
 * Decide whether a failed source is worth retrying, from its upstream error
 * string (apiData[source] = { error } for a failure; see apiCaller.foldBySource).
 *
 * "unavailable" = the upstream positively said the datapoint doesn't exist for
 * this ticker (a micro-cap with no financials → valuation's HTTP 500 "No
 * quarterly income statement data available", or a 4xx) — retrying won't help.
 * Everything else (timeout, network, 5xx, all-bases-down) is "retryable".
 *
 * No-data signals are checked first so a 5xx that carries a no-data detail is
 * not mislabeled as a transient blip.
 */
function classifyDegrade(entry: unknown): DegradeKind {
  const msg = String(
    entry && typeof entry === "object" && "error" in entry
      ? (entry as { error: unknown }).error
      : entry ?? "",
  ).toLowerCase();
  if (/data available|not available|no quarterly|insufficient data|not found|http 40\d|http 422/.test(msg)) {
    return "unavailable";
  }
  return "retryable";
}

/**
 * When the user's requested sources failed (absent from validData), tell them —
 * splitting "slow/unreachable upstream" (retry may help) from "no data for this
 * ticker" (retry won't), so a data-less micro-cap doesn't get a misleading
 * "retry shortly" prompt. See classifyDegrade.
 */
export function buildDegradedNotice(
  apiData: Record<string, any> | null,
  validData: Record<string, any>,
  language: "en" | "zh",
): string | undefined {
  if (!apiData) return undefined;
  const missing = Object.keys(apiData).filter((s) => !(s in validData));
  if (missing.length === 0) return undefined;

  const zh = language === "zh";
  const join = (xs: string[]) => xs.join(zh ? "、" : ", ");
  const retryable: string[] = [];
  const unavailable: string[] = [];
  for (const s of missing) {
    (classifyDegrade(apiData[s]) === "unavailable" ? unavailable : retryable).push(prettySource(s));
  }

  const clauses: string[] = [];
  if (retryable.length) {
    clauses.push(
      zh
        ? `实时数据暂时未能获取（${join(retryable)}）。上游较慢或暂时不可用，建议稍后重试。`
        : `Couldn't retrieve live data right now (${join(retryable)}). The provider is slow or temporarily unavailable — please retry shortly.`,
    );
  }
  if (unavailable.length) {
    clauses.push(
      zh
        ? `暂无相关数据（${join(unavailable)}）。该标的可能缺少对应的基础数据，重试通常无效。`
        : `No data available (${join(unavailable)}). This ticker likely lacks the underlying data, so retrying won't help.`,
    );
  }
  const tail = zh
    ? "以下回答基于其余可用数据，可能不完整。"
    : "The answer below uses the remaining available data and may be incomplete.";
  return `⚠️ ${[...clauses, tail].join(zh ? "" : " ")}`;
}

/** Split LLM output into the markdown body and the parsed META tail (verdict). */
export function splitUnifiedOutput(raw: string): { body: string; verdict?: UnifiedAnswer["verdict"] } {
  const idx = raw.indexOf(META_SEPARATOR);
  if (idx < 0) return { body: raw.trim() };
  const body = raw.slice(0, idx).trim();
  const metaRaw = raw.slice(idx + META_SEPARATOR.length).trim();
  try {
    const fence = metaRaw.match(/```(?:json)?\s*([\s\S]*?)```/);
    const parsed = JSON.parse(fence ? fence[1].trim() : metaRaw);
    const v = parsed?.verdict;
    if (v && typeof v === "object" && typeof v.stance === "string" && v.stance.trim()) {
      return {
        body,
        verdict: {
          stance: v.stance,
          ...(typeof v.conviction === "string" ? { conviction: v.conviction } : {}),
          ...(typeof v.priceTarget === "string" ? { priceTarget: v.priceTarget } : {}),
        },
      };
    }
  } catch { /* no / invalid META — body-only answer */ }
  return { body };
}

/**
 * Unified answer path (merge of SIMPLE + Brief). One buffered LLM call against the
 * intent-conditioned unified prompt; splits "markdown body + <<<META>>>" and
 * returns the body (for onChunk) plus a TS-built sidecar (verdict from META —
 * kept only when the intent wants one — and sources/cards from the retrieved
 * data). Flag-gated in index.ts; not yet the default.
 * See docs/UNIFIED_ANSWER_CONTRACT_DESIGN.md.
 */
export async function generateUnifiedAnswer(
  userQuery: string,
  apiData: Record<string, any> | null,
  conversationHistory: Message[],
  language: "en" | "zh",
  intent: AnswerIntent,
  signal?: AbortSignal,
): Promise<UnifiedAnswer> {
  let userContent = `User Question: ${userQuery}\n\n`;
  let citations: Citation[] = [];
  let resolvedValidData: Record<string, any> = {};

  if (apiData && Object.keys(apiData).length > 0) {
    const validData = Object.fromEntries(
      Object.entries(simplifyApiData(apiData)).filter(([, d]) => d && !d.error),
    );
    resolvedValidData = validData;
    if (Object.keys(validData).length > 0) {
      const cited = buildCitedData(validData);
      // B2: enrich the NEWS citation with article titles from the raw payload
      // while keeping its URL set = exactly what the LLM was fed (see
      // enrichNewsCitations — no foreign search_results urls leak in).
      citations = enrichNewsCitations(cited.citations, apiData.NEWS);
      userContent +=
        `Available Data (freshly retrieved — authoritative, supersede any prior numbers). ` +
        `Each block is tagged 【SOURCE | cite=S#】 — cite the claims you draw from it inline as [S#]:\n` +
        cited.promptBlocks;
    } else {
      userContent += `(No external data available — answer from financial knowledge; say so where data is required.)`;
    }
  } else {
    userContent += `(No external data available — answer from financial knowledge; say so where data is required.)`;
  }

  const messages: Message[] = [
    { role: "system", content: getUnifiedPrompt(language, intent) },
    ...conversationHistory.slice(-10),
    { role: "user", content: userContent },
  ];

  const chain = resolveChatChain();
  if (chain.length === 0) throw new Error("DeepSeek API key not configured");

  let rawOutput = "";
  try {
    const { response, providerId } = await callChatWithFailover(
      chain,
      { messages, temperature: 0.3, max_tokens: 4000 },
      { signal },
    );
    if (providerId !== chain[0].id) logger.warn("unified.failover", { to: providerId });
    rawOutput = response.choices?.[0]?.message?.content || "";
  } catch (llmError) {
    logger.warn("unified.fallback", {
      reason: llmError instanceof Error ? llmError.message : String(llmError),
    });
    const fallback = await tryGeminiFallback(userQuery, language);
    if (fallback) return { body: fallback, citations };
    throw llmError;
  }

  const { body, verdict } = splitUnifiedOutput(rawOutput);
  const keepVerdict = intentWantsVerdict(intent) ? verdict : undefined;
  const flatSources = citations.flatMap((c) => c.sources);
  const cards = buildSourceCards(apiData, resolvedValidData, flatSources, language);
  const notice = buildDegradedNotice(apiData, resolvedValidData, language);
  return {
    body,
    ...(keepVerdict ? { verdict: keepVerdict } : {}),
    citations,
    ...(Object.keys(cards).length > 0 ? { source_cards: cards } : {}),
    ...(notice ? { notice } : {}),
  };
}

// ─────────────────────────────────────────────
// NEWS BRIEF GENERATOR
// ─────────────────────────────────────────────

interface NewsBriefContext {
  newsContent: string;
  ticker?: string | null;
  sources?: BriefSource[];
  citations?: string[];
}

interface LegacyBriefItem {
  text: string;
  source?: string;
}

interface BriefSource {
  url: string;
  title?: string;
  publisher?: string;
  date?: string;
  ref?: string;
  index?: number;
}

interface LegacyNewsItem {
  text: string;
  sources?: BriefSource[];
  sourceRefs?: string[];
}

interface LegacyBrief {
  insights: LegacyBriefItem[];
  analyses: LegacyBriefItem[];
  responseLanguage?: "en" | "zh";
  ticker?: string;
  companyName?: string;
  currentPrice?: number;
  currency?: string;
  date?: string;
  newsItems?: LegacyNewsItem[];
  keySignals?: string[];
  whatMatters?: {
    coreDrivers?: string[];
    whyItMatters?: string;
  };
  expectationGap?: {
    alreadyPricedIn?: string;
    newInformation?: string;
  };
  historicalInsight?: {
    similarCase?: string;
    pattern?: string;
    implication?: string;
  };
  valuationData?: {
    intrinsicValue?: string;
    currentVsTarget?: string;
    verdict?: string;
    confidence?: string;
    recommendation?: string;
    priceTarget?: string;
  };
  valuationImpact?: {
    driver?: string;
    direction?: string;
    duration?: string;
    summary?: string;
  };
  bottomLine?: {
    realityCheck?: string;
    valuationChange?: string;
    watchNext?: string;
  };
  earningsSummary?: {
    quarter?: string;
    sentiment?: string;
    summary?: string;
    highlights?: string[];
    source?: string;
  };
}

const isNonEmptyStr = (v: unknown): v is string =>
  typeof v === "string" && v.trim().length > 0;

const splitNumberedPoints = (s: string): string[] => {
  if (!isNonEmptyStr(s)) return [];
  // Split on lines or "1. ", "2. " markers, drop the leading number, trim
  return s
    .split(/\n+/)
    .map((line) => line.replace(/^\s*\d+[.)、]\s*/, "").trim())
    .filter((line) => line.length > 0);
};

const splitContentPoints = (s: string): string[] => {
  if (!isNonEmptyStr(s)) return [];
  const body = s.split(/\n\s*Sources:\s*\n/i)[0] || s;
  return splitNumberedPoints(body);
};

const normalizeUrl = (value: unknown): string => {
  if (typeof value !== "string") return "";
  const trimmed = value.trim().replace(/[)\].,;]+$/, "");
  return /^https?:\/\//i.test(trimmed) ? trimmed : "";
};

const normalizeBriefSources = (
  sources: unknown,
  citations: unknown,
  content?: string,
): BriefSource[] => {
  const result: BriefSource[] = [];
  const seen = new Set<string>();

  const addSource = (source: Partial<BriefSource> & { url?: string }) => {
    const url = normalizeUrl(source.url);
    if (!url || seen.has(url)) return;
    seen.add(url);
    result.push({
      url,
      ...(isNonEmptyStr(source.title) ? { title: source.title } : {}),
      ...(isNonEmptyStr(source.publisher) ? { publisher: source.publisher } : {}),
      ...(isNonEmptyStr(source.date) ? { date: source.date } : {}),
      ...(isNonEmptyStr(source.ref) ? { ref: source.ref } : {}),
      ...(typeof source.index === "number" ? { index: source.index } : {}),
    });
  };

  if (Array.isArray(sources)) {
    sources.forEach((entry, index) => {
      if (typeof entry === "string") {
        addSource({ url: entry, index });
        return;
      }
      if (!entry || typeof entry !== "object") return;
      const record = entry as Record<string, unknown>;
      addSource({
        url: String(record.url || ""),
        title: isNonEmptyStr(record.title) ? record.title : undefined,
        publisher: isNonEmptyStr(record.publisher)
          ? record.publisher
          : isNonEmptyStr(record.source)
            ? record.source
            : undefined,
        date: isNonEmptyStr(record.date) ? record.date : undefined,
        ref: isNonEmptyStr(record.ref) ? record.ref : undefined,
        index,
      });
    });
  }

  if (Array.isArray(citations)) {
    citations.forEach((url, index) => addSource({ url: String(url || ""), index }));
  }

  if (isNonEmptyStr(content)) {
    const urls = content.match(/https?:\/\/[^\s)\]]+/g) || [];
    urls.forEach((url, index) => addSource({ url, index }));
  }

  return result;
};

const parseNewsSourceRefs = (newsSection: string): Map<number, string[]> => {
  const mapping = new Map<number, string[]>();
  if (!isNonEmptyStr(newsSection)) return mapping;

  const sourceBlock = newsSection.split(/\n\s*Sources:\s*\n/i)[1] || "";
  sourceBlock.split(/\n+/).forEach((line) => {
    const match = line.match(/^\s*(\d+)[.)]\s*(.+)$/);
    if (!match) return;
    const sourceNumber = Number.parseInt(match[1], 10);
    if (!Number.isFinite(sourceNumber) || sourceNumber <= 0) return;
    const refs = Array.from(match[2].matchAll(/\[web:(\d+)\]/g)).map((ref) => `web:${ref[1]}`);
    if (refs.length > 0) mapping.set(sourceNumber - 1, refs);
  });

  return mapping;
};

const sourceMatchesRef = (source: BriefSource, ref: string): boolean => {
  if (source.ref === ref) return true;
  const numeric = Number.parseInt(ref.replace(/^web:/, ""), 10);
  return Number.isFinite(numeric) && source.index === numeric;
};

const resolveSourcesForNewsItem = (
  itemIndex: number,
  text: string,
  refMap: Map<number, string[]>,
  sourcePool: BriefSource[],
): { sources: BriefSource[]; refs: string[] } => {
  const markerRefs = Array.from(text.matchAll(/\((\d+)\)/g))
    .map((match) => Number.parseInt(match[1], 10))
    .filter((value) => Number.isFinite(value) && value > 0)
    .flatMap((value) => refMap.get(value - 1) || []);
  const refs = markerRefs.length > 0 ? markerRefs : refMap.get(itemIndex) || [];
  const seen = new Set<string>();
  const sources: BriefSource[] = [];

  refs.forEach((ref) => {
    const source = sourcePool.find((entry) => sourceMatchesRef(entry, ref));
    if (source && !seen.has(source.url)) {
      seen.add(source.url);
      sources.push(source);
    }
  });

  if (sources.length === 0) {
    const fallback = sourcePool[itemIndex];
    if (fallback) {
      sources.push(fallback);
    }
  }

  return { sources, refs };
};

const cleanNewsText = (text: string): string =>
  text.replace(/\s*\(\d+(?:\s*,\s*\d+)*\)\s*$/g, "").trim();

const buildNewsItems = (newsSection: string, sourcePool: BriefSource[]): LegacyNewsItem[] => {
  const refMap = parseNewsSourceRefs(newsSection);
  return splitContentPoints(newsSection).map((item, index) => {
    const { sources, refs } = resolveSourcesForNewsItem(index, item, refMap, sourcePool);
    return {
      text: cleanNewsText(item),
      ...(sources.length > 0 ? { sources } : {}),
      ...(refs.length > 0 ? { sourceRefs: refs } : {}),
    };
  });
};

const normalizeSmartNewsItems = (items: unknown, sourcePool: BriefSource[]): LegacyNewsItem[] => {
  if (!Array.isArray(items)) return [];

  return items
    .map((entry, index): LegacyNewsItem | null => {
      const record = typeof entry === "object" && entry ? (entry as Record<string, unknown>) : {};
      const text = typeof entry === "string" ? entry : record.text;
      if (!isNonEmptyStr(text)) return null;

      const sourceRefs = Array.isArray(record.sourceRefs)
        ? record.sourceRefs.filter(isNonEmptyStr)
        : [];
      const explicitSources = normalizeBriefSources(record.sources, [], undefined);
      const fallbackSources =
        explicitSources.length > 0
          ? explicitSources
          : sourceRefs
            .map((ref) => sourcePool.find((source) => sourceMatchesRef(source, ref)))
            .filter((source): source is BriefSource => Boolean(source));
      const sources = fallbackSources.length > 0 ? fallbackSources : sourcePool[index] ? [sourcePool[index]] : [];

      return {
        text: cleanNewsText(text),
        ...(sources.length > 0 ? { sources } : {}),
        ...(sourceRefs.length > 0 ? { sourceRefs } : {}),
      };
    })
    .filter((item): item is LegacyNewsItem => Boolean(item));
};

const t = (lang: "en" | "zh", en: string, zh: string) => (lang === "zh" ? zh : en);

function adaptSmartBriefToLegacy(
  sb: any,
  language: "en" | "zh",
  sourcePool: BriefSource[] = [],
): LegacyBrief {
  const aij = sb?.actionable_insights_json || {};
  const currentPrice =
    typeof sb?.current_price === "number"
      ? sb.current_price
      : typeof aij?.live_market?.current_price === "number"
        ? aij.live_market.current_price
        : undefined;
  const insights: LegacyBriefItem[] = [];
  const analyses: LegacyBriefItem[] = [];
  const structuredNewsItems = normalizeSmartNewsItems(sb?.news_items, sourcePool);

  // ─── insights: actionable / forward-looking items ───
  if (Array.isArray(aij.key_signal)) {
    aij.key_signal.filter(isNonEmptyStr).forEach((s: string) => insights.push({ text: s }));
  }

  const vd = aij.valuation_data;
  if (vd) {
    const parts: string[] = [];
    if (isNonEmptyStr(vd.verdict)) parts.push(`<strong>${t(language, "Verdict", "评级")}</strong>: ${vd.verdict}`);
    if (isNonEmptyStr(vd.recommendation)) parts.push(`<strong>${t(language, "Recommendation", "建议")}</strong>: ${vd.recommendation}`);
    if (isNonEmptyStr(vd.price_target)) parts.push(`<strong>${t(language, "Price Target", "目标价")}</strong>: ${vd.price_target}`);
    if (isNonEmptyStr(vd.intrinsic_value)) parts.push(`<strong>${t(language, "Intrinsic Value", "内在价值")}</strong>: ${vd.intrinsic_value}`);
    if (isNonEmptyStr(vd.current_vs_target)) parts.push(`<strong>${t(language, "Current vs Target", "当前 vs 目标")}</strong>: ${vd.current_vs_target}`);
    if (parts.length > 0) insights.push({ text: parts.join(" · ") });
  }

  if (aij.bottom_line) {
    if (isNonEmptyStr(aij.bottom_line.watch_next)) {
      insights.push({
        text: `<strong>${t(language, "Watch Next", "下一步关注")}</strong>: ${aij.bottom_line.watch_next}`,
      });
    }
    if (isNonEmptyStr(aij.bottom_line.reality_check)) {
      insights.push({
        text: `<strong>${t(language, "Reality Check", "事实核查")}</strong>: ${aij.bottom_line.reality_check}`,
      });
    }
  }

  // Fallback: section text if structured fields empty
  if (insights.length === 0 && isNonEmptyStr(sb?.actionable_insights_section)) {
    splitNumberedPoints(sb.actionable_insights_section).forEach((line) =>
      insights.push({ text: line }),
    );
  }

  // ─── analyses: explanatory / contextual items ───
  // Mirror SmartNews "Analysis" section: a clean numbered list pulled from
  // `analysis_section`. Structured labels (Core Drivers / Why It Matters /
  // Earnings Summary, etc.) remain available on the brief object below for
  // the Actionable Insights renderer.
  splitNumberedPoints(sb?.analysis_section).forEach((line) => analyses.push({ text: line }));

  return {
    insights,
    analyses,
    responseLanguage: language,
    ticker: isNonEmptyStr(aij.ticker) ? aij.ticker : isNonEmptyStr(sb?.ticker) ? sb.ticker : undefined,
    companyName: isNonEmptyStr(sb?.companyName)
      ? sb.companyName
      : isNonEmptyStr(sb?.company_name)
        ? sb.company_name
        : undefined,
    currentPrice,
    currency: isNonEmptyStr(sb?.currency) ? sb.currency : undefined,
    date: isNonEmptyStr(aij.date) ? aij.date : undefined,
    newsItems: structuredNewsItems.length > 0 ? structuredNewsItems : buildNewsItems(sb?.news_section, sourcePool),
    keySignals: Array.isArray(aij.key_signal) ? aij.key_signal.filter(isNonEmptyStr) : undefined,
    whatMatters: aij.what_matters
      ? {
          coreDrivers: Array.isArray(aij.what_matters.core_drivers)
            ? aij.what_matters.core_drivers.filter(isNonEmptyStr)
            : undefined,
          whyItMatters: isNonEmptyStr(aij.what_matters.why_it_matters)
            ? aij.what_matters.why_it_matters
            : undefined,
        }
      : undefined,
    expectationGap: aij.expectation_gap
      ? {
          alreadyPricedIn: isNonEmptyStr(aij.expectation_gap.already_priced_in)
            ? aij.expectation_gap.already_priced_in
            : undefined,
          newInformation: isNonEmptyStr(aij.expectation_gap.new_information)
            ? aij.expectation_gap.new_information
            : undefined,
        }
      : undefined,
    historicalInsight: aij.historical_insight
      ? {
          similarCase: isNonEmptyStr(aij.historical_insight.similar_case)
            ? aij.historical_insight.similar_case
            : undefined,
          pattern: isNonEmptyStr(aij.historical_insight.pattern)
            ? aij.historical_insight.pattern
            : undefined,
          implication: isNonEmptyStr(aij.historical_insight.implication)
            ? aij.historical_insight.implication
            : undefined,
        }
      : undefined,
    valuationData: aij.valuation_data
      ? {
          intrinsicValue: isNonEmptyStr(aij.valuation_data.intrinsic_value)
            ? aij.valuation_data.intrinsic_value
            : undefined,
          currentVsTarget: isNonEmptyStr(aij.valuation_data.current_vs_target)
            ? aij.valuation_data.current_vs_target
            : undefined,
          verdict: isNonEmptyStr(aij.valuation_data.verdict) ? aij.valuation_data.verdict : undefined,
          confidence: isNonEmptyStr(aij.valuation_data.confidence) ? aij.valuation_data.confidence : undefined,
          recommendation: isNonEmptyStr(aij.valuation_data.recommendation)
            ? aij.valuation_data.recommendation
            : undefined,
          priceTarget: isNonEmptyStr(aij.valuation_data.price_target)
            ? aij.valuation_data.price_target
            : undefined,
        }
      : undefined,
    valuationImpact: aij.valuation_impact
      ? {
          driver: isNonEmptyStr(aij.valuation_impact.driver) ? aij.valuation_impact.driver : undefined,
          direction: isNonEmptyStr(aij.valuation_impact.direction) ? aij.valuation_impact.direction : undefined,
          duration: isNonEmptyStr(aij.valuation_impact.duration) ? aij.valuation_impact.duration : undefined,
          summary: isNonEmptyStr(aij.valuation_impact.summary) ? aij.valuation_impact.summary : undefined,
        }
      : undefined,
    bottomLine: aij.bottom_line
      ? {
          realityCheck: isNonEmptyStr(aij.bottom_line.reality_check)
            ? aij.bottom_line.reality_check
            : undefined,
          valuationChange: isNonEmptyStr(aij.bottom_line.valuation_change)
            ? aij.bottom_line.valuation_change
            : undefined,
          watchNext: isNonEmptyStr(aij.bottom_line.watch_next) ? aij.bottom_line.watch_next : undefined,
        }
      : undefined,
    earningsSummary: aij.earnings_summary
      ? {
          quarter: isNonEmptyStr(aij.earnings_summary.quarter) ? aij.earnings_summary.quarter : undefined,
          sentiment: isNonEmptyStr(aij.earnings_summary.sentiment)
            ? aij.earnings_summary.sentiment
            : undefined,
          summary: isNonEmptyStr(aij.earnings_summary.summary) ? aij.earnings_summary.summary : undefined,
          highlights: Array.isArray(aij.earnings_summary.highlights)
            ? aij.earnings_summary.highlights.filter(isNonEmptyStr)
            : undefined,
          source: isNonEmptyStr(aij.earnings_summary.source) ? aij.earnings_summary.source : undefined,
        }
      : undefined,
  };
}

/**
 * Plain-prose streaming answer. Used by default for factual questions; the
 * multi-module Investment Brief template is reserved for explicit
 * "should I buy / is X a good investment" decision queries.
 */
async function generateSimpleAnswerStream(
  userQuery: string,
  apiData: Record<string, any> | null,
  conversationHistory: Message[],
  onChunk: (chunk: string) => void,
  language: "en" | "zh",
  generalKnowledgeOnly = false,
  signal?: AbortSignal,
): Promise<string> {
  const systemPrompt = getSimpleSystemPrompt(language);

  let userContent =
    language === "zh"
      ? `用户问题：${userQuery}\n\n`
      : `User Question: ${userQuery}\n\n`;

  // When the classifier already decided this is a concept / general-knowledge
  // question (need_api: false), the "no retrieved data" line below would
  // wrongly trigger the SIMPLE prompt's hard-refusal rule. Override it: give
  // the model permission to answer from training knowledge with a disclaimer.
  const noApiCall = !apiData || Object.keys(apiData).length === 0;
  const trainingKnowledgePath = generalKnowledgeOnly && noApiCall;

  if (apiData && Object.keys(apiData).length > 0) {
    const simplifiedData = simplifyApiData(apiData);
    const validData = Object.fromEntries(
      Object.entries(simplifiedData).filter(([, data]) => data && !data.error),
    );
    if (Object.keys(validData).length > 0) {
      userContent +=
        language === "zh"
          ? "已检索到的数据（最新数据，作为权威依据）：\n"
          : "Retrieved Data (use these as the authoritative source):\n";
      for (const [source, data] of Object.entries(validData)) {
        userContent += `\n【${source}】\n${JSON.stringify(data, null, 2)}\n`;
      }
    } else {
      userContent +=
        language === "zh"
          ? "（未检索到外部数据。如果问题确实需要数据，请明说找不到并停止，不要编造或转移话题。）\n"
          : "(No external data was retrieved. If the question genuinely requires data, say so plainly and stop — do not fabricate or pivot.)\n";
    }
  } else if (trainingKnowledgePath) {
    userContent +=
      language === "zh"
        ? "（这是一个常识 / 概念 / 列表类问题，分类器已判定无需实时检索。请用你的训练知识直接回答，遵守上述格式规范。若涉及具体数字（股价、市值、估值倍数等），用粗体明确标注\"非实时\"或注明是大致水平；最后用一行简短免责声明说明信息来自训练数据、可能滞后，建议核实最新数据。不要拒答、不要要求用户启用 API。\n\n⚠️ Ticker 准确性约束：列举公司时，**只在你高度确信**是该公司在美股主要交易所（NYSE / Nasdaq）的主代码时才写出 ticker。任何不确定都只写公司名 + 标注 *(ticker：待核实)*，**绝不要猜代码**——写错 ticker 比不写 ticker 更糟（用户会照错的代码下单）。非美股上市的公司（KUKA、Boston Dynamics、Denso 等）不要硬塞 ADR / OTC 代码，直接说明非美股上市即可。）\n"
        : "(This is a concept / general-knowledge / list-style question; the classifier already decided no real-time retrieval is needed. Answer directly from your training knowledge, following the formatting rules above. For any concrete figure (price, market cap, multiples), mark it as **approximate / training-data** rather than a live quote, and end with a one-line disclaimer that the information may be outdated and the user should verify with a live data source. Do not refuse and do not tell the user to enable an API.\n\n⚠️ Ticker accuracy rule: when listing companies, **only emit a ticker symbol when you are highly confident** it is the company's primary US listing (NYSE or Nasdaq). If you are not certain of the exact symbol, give the company name only and write *(ticker: verify)* — do NOT guess. A wrong ticker is worse than no ticker (users will trade on it). For companies not primarily listed in the US (KUKA, Boston Dynamics, Denso, etc.), do not invent an ADR / OTC code — say plainly that they are not US-listed.)\n";
  } else {
    userContent +=
      language === "zh"
        ? "（未检索到外部数据。）\n"
        : "(No external data was retrieved.)\n";
  }

  const messages: Message[] = [
    { role: "system", content: systemPrompt },
    ...conversationHistory.slice(-10),
    { role: "user", content: userContent },
  ];

  // Real per-token streaming via the failover chain: DeepSeek streams token by
  // token (onChunk per delta); if it fails BEFORE the first token, fall over to
  // Gemini (emitted as one chunk — see callChatStreamWithFailover). Once tokens
  // are flowing we are committed to DeepSeek (can't swap mid-answer). If the
  // whole chain fails, the existing /api/gemini-fallback HTML path is last resort.
  const chain = resolveChatChain();
  if (chain.length === 0) {
    throw new Error("DeepSeek API key not configured");
  }

  let rawOutput = "";
  try {
    const { response, providerId } = await callChatStreamWithFailover(
      chain,
      { messages, temperature: 0.3, max_tokens: 1500 },
      (delta) => onChunk(delta),
      { signal },
    );
    if (providerId !== chain[0].id) {
      logger.warn("generator.failover", { to: providerId, mode: "simple" });
    }
    rawOutput = response.choices?.[0]?.message?.content || "";
  } catch (llmError) {
    logger.warn("generator.fallback", {
      cause: "chain_failed",
      mode: "simple",
      reason: llmError instanceof Error ? llmError.message : String(llmError),
    });
    const fallback = await tryGeminiFallback(userQuery, language);
    if (fallback) { onChunk(fallback); return fallback; }
    throw llmError;
  }

  logger.success(`✅ Simple prose answer generated (${rawOutput.length} chars)`);
  return rawOutput;
}

async function generateNewsBrief(
  context: NewsBriefContext | string,
  language: "en" | "zh" = "en"
): Promise<string> {
  const { newsContent, ticker } =
    typeof context === "string"
      ? { newsContent: context, ticker: null }
      : { newsContent: context.newsContent, ticker: context.ticker ?? null };

  logger.info(`📊 Generating news brief via SmartNews (ticker=${ticker || "n/a"}, lang=${language})`);

  const url = `${getNewsApiBase()}/api/create-smart-brief`;
  const queryLabel = ticker
    ? `${ticker} latest news brief`
    : "latest news brief";

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        newsContent,
        query: queryLabel,
        language: "en",
        responseLanguage: language,
        tickerSymbol: ticker || null,
        includeStockPrice: !!ticker,
        sources: typeof context === "string" ? [] : context.sources || [],
        citations: typeof context === "string" ? [] : context.citations || [],
      }),
      signal: AbortSignal.timeout(SMART_BRIEF_TIMEOUT_MS),
    });

    if (!response.ok) {
      const body = (await response.text()).slice(0, SMART_BRIEF_ERROR_BODY_LIMIT);
      throw new Error(`SmartBrief upstream ${response.status} ${response.statusText} :: ${body}`);
    }

    const data: any = await response.json();
    logger.info(
      "🔍 SmartBrief raw response:\n" +
        "─".repeat(60) + "\n" +
        JSON.stringify(data, null, 2) +
        "\n" + "─".repeat(60)
    );
    const sb = data?.smartBrief;
    if (!sb) throw new Error("SmartBrief response missing smartBrief field");

    // Adapt SmartNews's rich JSON to the legacy {insights[], analyses[]} shape
    // so the client flow (NewsBriefCard, translation pipeline) stays unchanged.
    const sourcePool =
      typeof context === "string"
        ? normalizeBriefSources([], [], newsContent)
        : normalizeBriefSources(context.sources, context.citations, newsContent);
    const adapted = adaptSmartBriefToLegacy(sb, language, sourcePool);

    logger.success(
      `✅ News brief generated (SmartNews → adapted ${adapted.insights.length} insights, ${adapted.analyses.length} analyses)`,
    );
    return JSON.stringify(adapted);
  } catch (error) {
    logger.error("❌ News brief generation failed:", error);
    throw error;
  }
}
