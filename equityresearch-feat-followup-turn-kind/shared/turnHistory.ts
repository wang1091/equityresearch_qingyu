// Single source of truth for an assistant turn's two derived views:
//   - DISPLAY view  : the rich content restored into the client Message (news cards,
//                     unified-answer citations, …) — restore()
//   - CLASSIFIER view: the turn compacted to ONE line for intent-routing history —
//                     project()
// Imported by BOTH client (vite `@shared`) and server (tsconfig `@shared/*`) so the
// envelope prefix, parsing, and per-type logic exist in exactly ONE place instead of
// the four copies they used to (client serialize/restore + server toAgentHistoryContent
// + live projectListTurnToHistory). See docs/UNIFIED_TURN_HISTORY_PLAN.md.
//
// Backward compat (zero migration): persisted rows are EITHER a bare string (old plain
// answers) OR a {version:1,type,...} envelope (old news_v2/news_brief). parseEnvelope
// reads both; `text` re-serializes back to a bare string so new plain answers stay
// byte-identical to old ones. `version` stays 1 and types are additive.

import { projectSourceCard } from "./sourceCard";

export const STRUCTURED_MESSAGE_PREFIX = "__CHECKIT_STRUCTURED_MESSAGE__:";

export type UILang = "en" | "zh";

/**
 * One persisted turn. Type-specific structured data rides at the TOP LEVEL (not under
 * a nested `payload`) to stay byte-compatible with already-stored news envelopes.
 * `content` is the markdown/HTML body — always kept for display fallback + search.
 */
export interface TurnEnvelope {
  version: 1;
  type: string; // "text" | "news_v2" | "news_brief" | "unified" | "html_card" | <future source>
  content?: string;
  displayLanguage?: UILang;
  // Precomputed classifier-history line. When present it WINS over the type's own
  // project() — used by HTML direct cards (TRENDING/MARKET_DATA/STOCK_PICKER) whose
  // displayed `content` is rendered markup the classifier can't route on. The server
  // stamps the SAME line it feeds the live in-memory history, so reload === live.
  classifierText?: string;
  // Structured fields, present only for their type (typed loosely so shared/ stays
  // free of the client Message types):
  newsData?: any;
  newsDataEn?: any;
  newsDataZh?: any;
  briefData?: any;
  briefDataEn?: any;
  briefDataZh?: any;
  unifiedData?: any;
  competitiveData?: any;
  // Generic structured-card channel: { source, payload }. The per-source render
  // logic lives on the client; routing/projection lives in shared/sourceCard.ts.
  cardData?: { source: string; payload: any };
}

export interface TurnSpec {
  type: string;
  /** Compact the turn to one line for classifier-routing history. */
  project(env: TurnEnvelope): string;
  /** Fields to merge into the client Message when restoring from persistence. */
  restore?(env: TurnEnvelope): Record<string, unknown>;
}

const joinLines = (parts: Array<unknown>): string =>
  parts.filter((p): p is string => typeof p === "string" && p.length > 0).join("\n");

const TEXT_SPEC: TurnSpec = {
  type: "text",
  project: (env) => env.content ?? "",
  restore: (env) => ({ content: env.content ?? "" }),
};

const NEWS_V2_SPEC: TurnSpec = {
  type: "news_v2",
  // Verbatim from the old server toAgentHistoryContent (chatHistory.ts) — title/dek/summary.
  project: (env) => {
    const news = env.newsData || env.newsDataEn || env.newsDataZh;
    const c = news?.content || {};
    return joinLines([c.title, c.dek, c.summary]);
  },
  restore: (env) => ({
    content: env.content ?? "",
    displayLanguage: env.displayLanguage,
    newsData: env.newsData || env.newsDataEn || env.newsDataZh,
    newsDataEn: env.newsDataEn,
    newsDataZh: env.newsDataZh,
  }),
};

const NEWS_BRIEF_SPEC: TurnSpec = {
  type: "news_brief",
  // Verbatim from the old server toAgentHistoryContent — bottomLine + signals/insights/analyses.
  project: (env) => {
    const brief = env.briefData || env.briefDataEn || env.briefDataZh;
    const keySignals = Array.isArray(brief?.keySignals) ? brief.keySignals.filter(Boolean) : [];
    const insights = Array.isArray(brief?.insights)
      ? brief.insights.map((i: any) => i?.text).filter(Boolean)
      : [];
    const analyses = Array.isArray(brief?.analyses)
      ? brief.analyses.map((i: any) => i?.text).filter(Boolean)
      : [];
    return joinLines([
      "SmartNews brief:",
      brief?.bottomLine?.realityCheck,
      brief?.bottomLine?.valuationChange,
      brief?.bottomLine?.watchNext,
      ...keySignals,
      ...insights,
      ...analyses,
    ]);
  },
  restore: (env) => ({
    content: env.content ?? "",
    displayLanguage: env.displayLanguage,
    briefData: env.briefData || env.briefDataEn || env.briefDataZh,
    briefDataEn: env.briefDataEn,
    briefDataZh: env.briefDataZh,
  }),
};

const UNIFIED_SPEC: TurnSpec = {
  type: "unified",
  // The fused answer routes on its markdown body (names tickers etc.) — same text the
  // classifier saw before unifiedData was persisted. unifiedData is for DISPLAY only.
  project: (env) => env.content ?? "",
  restore: (env) => ({
    content: env.content ?? "",
    displayLanguage: env.displayLanguage,
    unifiedData: env.unifiedData,
  }),
};

// Backward-compat only: COMPETITIVE folded onto the generic source_card channel
// (live turns now persist as `source_card`). This spec stays so conversations
// persisted BEFORE the fold still reload — it re-projects via the shared projector
// and restores the old `competitiveData` into `cardData` so the renderer registry
// (source "COMPETITIVE") draws it. See docs/CARD_RENDER_MIGRATION_PLAN.md §8.
const COMPETITIVE_SPEC: TurnSpec = {
  type: "competitive",
  project: (env) => (env.competitiveData ? projectSourceCard("COMPETITIVE", env.competitiveData) : (env.content ?? "")),
  restore: (env) => ({
    content: env.content ?? "",
    displayLanguage: env.displayLanguage,
    cardData: env.competitiveData ? { source: "COMPETITIVE", payload: env.competitiveData } : undefined,
  }),
};

// Generic structured card (the migration target — RATING, then the rest). `content`
// is unused (""); display + routing both derive from cardData.{source,payload}.
const SOURCE_CARD_SPEC: TurnSpec = {
  type: "source_card",
  project: (env) =>
    env.cardData ? projectSourceCard(env.cardData.source, env.cardData.payload) : (env.content ?? ""),
  restore: (env) => ({
    content: env.content ?? "",
    displayLanguage: env.displayLanguage,
    cardData: env.cardData,
  }),
};

// An HTML direct card (TRENDING / MARKET_DATA / STOCK_PICKER): `content` is rendered
// markup for display; routing rides the precomputed `classifierText` (see below).
const HTML_CARD_SPEC: TurnSpec = {
  type: "html_card",
  project: (env) => env.content ?? "",
  restore: (env) => ({ content: env.content ?? "", displayLanguage: env.displayLanguage }),
};

export const TURN_REGISTRY: Record<string, TurnSpec> = {
  text: TEXT_SPEC,
  news_v2: NEWS_V2_SPEC,
  news_brief: NEWS_BRIEF_SPEC,
  unified: UNIFIED_SPEC,
  competitive: COMPETITIVE_SPEC,
  source_card: SOURCE_CARD_SPEC,
  html_card: HTML_CARD_SPEC,
};

/** Parse a persisted content string into a TurnEnvelope. Bare strings (no prefix) and
 *  malformed/version-mismatched envelopes degrade to a `text` envelope — never throws. */
export function parseEnvelope(content: string): TurnEnvelope {
  if (!content.startsWith(STRUCTURED_MESSAGE_PREFIX)) {
    return { version: 1, type: "text", content };
  }
  try {
    const parsed = JSON.parse(content.slice(STRUCTURED_MESSAGE_PREFIX.length));
    if (parsed?.version === 1 && typeof parsed.type === "string") {
      return parsed as TurnEnvelope;
    }
  } catch {
    // fall through to text
  }
  return { version: 1, type: "text", content };
}

/** Serialize a TurnEnvelope. `text` (no structured data) degrades to a bare string so
 *  plain answers stay byte-identical to the legacy format; everything else is prefixed JSON. */
export function serializeEnvelope(env: TurnEnvelope): string {
  if (env.type === "text") return env.content ?? "";
  return `${STRUCTURED_MESSAGE_PREFIX}${JSON.stringify(env)}`;
}

/** Resolve the spec for a type, falling back to `text` for unknown/legacy types. */
export function specFor(type: string): TurnSpec {
  return TURN_REGISTRY[type] ?? TEXT_SPEC;
}

/** Parse a persisted content string and project it to one line of classifier history.
 *  Unknown structured types fall back to their `content` (better than dropping it). */
export function projectToClassifierHistory(content: string): string {
  const env = parseEnvelope(content);
  // A precomputed line (HTML cards) wins over any type-specific projection.
  if (typeof env.classifierText === "string" && env.classifierText.length > 0) {
    return env.classifierText;
  }
  const spec = TURN_REGISTRY[env.type];
  if (spec) return spec.project(env);
  return env.content ?? "";
}
