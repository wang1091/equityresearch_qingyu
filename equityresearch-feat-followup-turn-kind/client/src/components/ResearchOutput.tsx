import React from "react";
import { jsonrepair } from "jsonrepair";
import { SafeHtmlContent } from "./SafeHtmlContent";
import { extractFirstJsonValue, parseLooseJson } from "@/utils/agentJsonPayload";

// ─── Types ────────────────────────────────────────────────────────────────────

type Rating = string;

interface ResearchModule {
  module: string;
  icon: string;
  rating: Rating;
  reasoning_steps: string[];
  conclusion: string;
  sources: string[];
}

interface EvidenceGraph {
  bull_case: string[];
  bear_case: string[];
  key_metrics: Record<string, string>;
}

interface InvestmentDecision {
  verdict: string;
  conviction: string;
  price_target: string;
  current_price: string;
  upside_downside: string;
  time_horizon: string;
  summary: string;
  risk_disclaimer: string;
}

/** TS-derived, verifiable source attached to the fused answer (server/agent/provenance.ts). */
export type BriefSourceRef =
  | { type: "link"; provider: string; ticker?: string | null; url: string; publisher?: string; title?: string; date?: string }
  | { type: "model"; id: string; provider: string; ticker?: string | null; engine: string; method?: string; asOf: string }
  | { type: "data"; id: string; provider: string; ticker?: string | null; asOf: string };

export interface ResearchData {
  query_understanding: {
    intent: string;
    tickers: string[];
    data_sources_used: string[];
    reasoning: string;
  };
  modules: ResearchModule[];
  evidence_graph: EvidenceGraph;
  investment_decision: InvestmentDecision;
  sources?: BriefSourceRef[];
  /** Drill-down card HTML for card-backed sources, keyed by BriefSourceRef.id. */
  source_cards?: Record<string, string>;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function repairJson(str: string): string {
  let s = str;
  // Fix: missing closing-quote + comma before the next bare key.
  // e.g. "conviction": "LOW "price_target": → "conviction": "LOW ", "price_target":
  s = s.replace(/"([a-zA-Z_][a-zA-Z0-9_]*)("(\s*):)/g, (match, word, rest, _sp, offset, full) => {
    const prevChars = full.slice(Math.max(0, offset - 15), offset);
    const lastSep = Math.max(
      prevChars.lastIndexOf(','),
      prevChars.lastIndexOf('{'),
      prevChars.lastIndexOf('['),
    );
    const lastQuote = prevChars.lastIndexOf('"');
    if (lastQuote > lastSep) {
      return '", "' + word + rest;
    }
    return match;
  });
  // Remove trailing commas before } or ]
  s = s.replace(/,(\s*[}\]])/g, '$1');
  // Close unclosed braces/brackets
  const opens = (s.match(/\{/g) || []).length;
  const closes = (s.match(/\}/g) || []).length;
  const arrOpens = (s.match(/\[/g) || []).length;
  const arrCloses = (s.match(/\]/g) || []).length;
  s += ']'.repeat(Math.max(0, arrOpens - arrCloses));
  s += '}'.repeat(Math.max(0, opens - closes));
  return s;
}

/** Strip fences, normalize smart quotes, BOM — fixes parse + gate checks */
function preprocessResearchJsonContent(content: string): string {
  let s = content.trim().replace(/^\uFEFF/, "");
  const fenced = /^```(?:json)?\s*\n?([\s\S]*?)```\s*$/im.exec(s);
  if (fenced) {
    s = fenced[1].trim();
  } else {
    s = s.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
  }
  s = s.replace(/[\u201c\u201d\u00ab\u00bb]/g, '"');
  s = s.replace(/[\u2018\u2019]/g, "'");
  return s;
}

const DEFAULT_RISK_EN =
  "⚠️ This analysis is for informational purposes only and does not constitute financial advice.";
const DEFAULT_RISK_ZH = "⚠️ 投资有风险，本分析仅供参考，不构成投资建议。";

function synthesizeInvestmentDecision(parsed: any, isZhHint: boolean): InvestmentDecision {
  const mods: ResearchModule[] = Array.isArray(parsed.modules) ? parsed.modules : [];
  const conclusions = mods.map((m) => m?.conclusion).filter(Boolean) as string[];
  const summary =
    conclusions.length > 0
      ? conclusions.join("<br><br>")
      : "<em>See analyst modules above.</em>";
  return {
    verdict: "NEUTRAL",
    conviction: "LOW",
    price_target: "N/A",
    current_price: "N/A",
    upside_downside: "N/A",
    time_horizon: "N/A",
    summary,
    risk_disclaimer: isZhHint ? DEFAULT_RISK_ZH : DEFAULT_RISK_EN,
  };
}

function mergeInvestmentDecision(dec: any, isZhHint: boolean): InvestmentDecision {
  if (!dec || typeof dec !== "object") {
    return synthesizeInvestmentDecision({ modules: [] }, isZhHint);
  }
  const summary =
    typeof dec.summary === "string" && dec.summary.trim()
      ? dec.summary
      : typeof dec.final_summary === "string"
        ? dec.final_summary
        : "";
  const risk =
    dec.risk_disclaimer ||
    dec["red flags"] ||
    dec.red_flags ||
    (isZhHint ? DEFAULT_RISK_ZH : DEFAULT_RISK_EN);
  return {
    verdict: dec.verdict || "NEUTRAL",
    conviction: dec.conviction || "MEDIUM",
    price_target: dec.price_target || dec.Price_Target || "N/A",
    current_price: dec.current_price || dec.Current_Price || dec.currentPrice || "N/A",
    upside_downside: dec.upside_downside || dec.UpsideDownside || dec.upsideDownside || "N/A",
    time_horizon: dec.time_horizon || dec.Time_Horizon || "N/A",
    summary: summary || "<em>See analyst modules above.</em>",
    risk_disclaimer: risk,
  };
}

function labelFromSnakeKey(key: string): string {
  return key
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Map alternate LLM key spellings / casing onto the shape ResearchOutput expects */
function liftResearchGraphShape(parsed: any): any {
  if (!parsed || typeof parsed !== "object") return parsed;
  const p = parsed as Record<string, unknown>;
  const pick = <T,>(...keys: string[]): T | undefined => {
    for (const k of keys) {
      if (p[k] !== undefined && p[k] !== null) return p[k] as T;
    }
    return undefined;
  };

  const qu = pick(
    "query_understanding",
    "Query_Understanding",
    "queryUnderstanding",
    "QueryUnderstanding",
    "bully_understanding",
    "Bully_Understanding",
  );
  if (qu && typeof qu === "object") p.query_understanding = qu;

  const egLift = pick("evidence_graph", "Evidence_Graph", "evidenceGraph", "EvidenceGraph");
  if (egLift && typeof egLift === "object") p.evidence_graph = egLift;

  let mods = pick<unknown[] | Record<string, unknown>>(
    "modules",
    "Modules",
    "MODULES",
    "analyst_modules",
    "AnalystModules",
  );
  if (mods !== undefined) {
    if (Array.isArray(mods)) {
      p.modules = mods;
    } else if (mods && typeof mods === "object") {
      const vals = Object.values(mods as Record<string, unknown>);
      p.modules = vals.length > 0 && vals.every((v) => v && typeof v === "object") ? vals : [mods];
    }
  }

  return p;
}

/** Ensure query_understanding has tickers[] and data_sources_used[] for UI + parse gates */
function coerceQueryUnderstanding(parsed: any): void {
  const qu = parsed?.query_understanding;
  if (!qu || typeof qu !== "object") return;
  if (!Array.isArray(qu.tickers)) {
    if (typeof qu.ticker === "string" && qu.ticker.trim()) {
      qu.tickers = [qu.ticker.trim().toUpperCase()];
    } else if (Array.isArray(qu.ticker)) {
      qu.tickers = qu.ticker.map((t: unknown) => String(t).trim()).filter(Boolean);
    } else {
      qu.tickers = [];
    }
    try {
      delete qu.ticker;
    } catch {
      /* ignore */
    }
  }
  if (!Array.isArray(qu.data_sources_used)) {
    const raw = qu.data_sources_used;
    if (raw == null) qu.data_sources_used = [];
    else if (typeof raw === "string" && raw.trim()) qu.data_sources_used = [raw.trim()];
    else qu.data_sources_used = [];
  }
}

/**
 * Map alternate module shapes (LLM drift) onto ResearchModule so ResearchOutput renders.
 */
function normalizeResearchModules(mods: unknown[]): ResearchModule[] {
  if (!Array.isArray(mods) || mods.length === 0) return [];
  const iconPool = ["📰", "📞", "💰", "📈", "📊", "🔍", "💊", "🏭", "📋"];

  const pickStr = (...vals: unknown[]): string => {
    for (const v of vals) {
      if (typeof v === "string" && v.trim()) return v.trim();
    }
    return "";
  };

  return mods.map((raw, i) => {
    if (typeof raw === "string") {
      const t = raw.trim();
      return {
        module: `Research block ${i + 1}`,
        icon: iconPool[i % iconPool.length] ?? "📊",
        rating: "NEUTRAL",
        reasoning_steps: t.length > 700 ? [`${t.slice(0, 700)}…`] : [t || "—"],
        conclusion: t.length > 700 ? t.slice(700) : t || "—",
        sources: [],
      };
    }
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      return {
        module: "Analyst",
        icon: iconPool[i % iconPool.length] ?? "📊",
        rating: "NEUTRAL",
        reasoning_steps: [],
        conclusion: "—",
        sources: [],
      };
    }
    const o = raw as Record<string, unknown>;
    const moduleName =
      pickStr(o.module, o.name, o.analyst, o.role, o.title, o.agent, o.expert, o.module_name) ||
      `Analyst ${i + 1}`;
    let rating = pickStr(o.rating, o.signal, o.stance, o.verdict, o.sentiment).toUpperCase();
    if (!rating) rating = "NEUTRAL";
    const icon = pickStr(o.icon) || iconPool[i % iconPool.length] || "📊";

    const steps: string[] = [];
    if (Array.isArray(o.reasoning_steps)) {
      for (const s of o.reasoning_steps) {
        if (typeof s === "string" && s.trim()) steps.push(s.trim());
      }
    }
    const longKeys = [
      "analysis",
      "report",
      "findings",
      "narrative",
      "content",
      "body",
      "text",
      "detail",
      "overview",
    ];
    for (const k of longKeys) {
      const v = o[k];
      if (typeof v === "string" && v.trim().length > 24) {
        const t = v.trim();
        if (!steps.some((s) => s.slice(0, 48) === t.slice(0, 48))) steps.push(t);
      }
    }

    let conclusion =
      pickStr(o.conclusion, o.verdict_summary, o.takeaway, o.summary_line) ||
      (steps.length ? steps[steps.length - 1]!.slice(0, 1200) : "");
    if (!conclusion) conclusion = "—";

    const srcRaw = o.sources ?? o.citations ?? o.urls ?? o.references ?? o.links;
    let sources: string[] = [];
    if (Array.isArray(srcRaw)) {
      sources = srcRaw.map((x) => String(x)).filter(Boolean).slice(0, 24);
    } else if (typeof srcRaw === "string" && srcRaw.trim()) {
      sources = [srcRaw.trim()];
    }

    const reasoning_steps = steps.length > 0 ? steps : [conclusion.slice(0, 600) || "—"];

    return {
      module: moduleName,
      icon,
      rating,
      reasoning_steps,
      conclusion,
      sources,
    };
  });
}

/**
 * When the model returns a flat / typo JSON shape, coerce into ResearchData fields
 * so we can use ResearchOutput instead of dumping raw text.
 */
function synthesizeMissingResearchParts(parsed: any): boolean {
  if (!parsed.query_understanding || typeof parsed.query_understanding !== "object") {
    const theme = typeof parsed.theme === "string" ? parsed.theme.trim() : "";
    const summary = typeof parsed.summary === "string" ? parsed.summary.trim() : "";
    const tickers = Array.isArray(parsed.tickers) ? parsed.tickers.map(String) : [];
    const rawSources = parsed.stats_sources_used ?? parsed.data_sources_used;
    const dataSourcesUsed = Array.isArray(rawSources)
      ? rawSources.map(String)
      : rawSources != null && String(rawSources).trim()
        ? [String(rawSources)]
        : [];

    if (theme || summary || tickers.length > 0 || dataSourcesUsed.length > 0) {
      parsed.query_understanding = {
        intent: theme || "Professional analysis",
        tickers,
        data_sources_used: dataSourcesUsed,
        reasoning: summary.slice(0, 800) || (theme ? `Focus: ${theme}` : "Derived from model response."),
      };
    } else {
      const fallbackReasoning = ["analyst_report", "investment_thesis", "short_term_outlook", "summary"]
        .map((k) => (typeof parsed[k] === "string" ? (parsed[k] as string).trim().slice(0, 240) : ""))
        .filter(Boolean)
        .join("\n\n");
      if (fallbackReasoning) {
        parsed.query_understanding = {
          intent: "Structured response",
          tickers: [],
          data_sources_used: [],
          reasoning: fallbackReasoning.slice(0, 800),
        };
      } else {
        return false;
      }
    }
  }

  if (!Array.isArray(parsed.modules) || parsed.modules.length === 0) {
    const blocks: ResearchModule[] = [];
    const pushBlock = (key: string, icon: string) => {
      const v = parsed[key];
      if (typeof v !== "string" || !v.trim()) return;
      const text = v.trim();
      blocks.push({
        module: labelFromSnakeKey(key),
        icon,
        rating: "NEUTRAL",
        reasoning_steps: [text.length > 360 ? `${text.slice(0, 360)}…` : text],
        conclusion: text.length > 520 ? `${text.slice(0, 520)}…` : text,
        sources: [],
      });
    };
    pushBlock("analyst_report", "📰");
    pushBlock("investment_thesis", "💡");
    pushBlock("short_term_outlook", "📈");
    if (typeof parsed.summary === "string" && parsed.summary.trim() && !blocks.some((b) => b.module === "Summary")) {
      pushBlock("summary", "📋");
    }
    if (blocks.length > 0) parsed.modules = blocks;
    else return false;
  }

  return true;
}

/** Final steps shared by strict parse and loose-object hydration. */
function finalizeParsedResearchToData(parsed: any, isZhHint: boolean): ResearchData {
  coerceQueryUnderstanding(parsed);
  parsed.modules = normalizeResearchModules(parsed.modules);

  let inv =
    parsed.investment_decision ||
    parsed.Analysis_Decision ||
    parsed.analysis_decision ||
    parsed.Investment_Decision;

  if (!inv && typeof parsed.final_summary === "string" && parsed.final_summary.trim()) {
    inv = {
      verdict: "NEUTRAL",
      conviction: "MEDIUM",
      price_target: "N/A",
      current_price: "N/A",
      upside_downside: "N/A",
      time_horizon: "N/A",
      summary: parsed.final_summary,
    };
  }

  if (!inv) {
    inv = synthesizeInvestmentDecision(parsed, isZhHint);
  } else {
    inv = mergeInvestmentDecision(inv, isZhHint);
  }

  parsed.investment_decision = inv;

  if (!parsed.evidence_graph || typeof parsed.evidence_graph !== "object") {
    parsed.evidence_graph = {
      bull_case: [],
      bear_case: [],
      key_metrics: {},
    };
  } else {
    const eg = parsed.evidence_graph;
    if (!Array.isArray(eg.bull_case)) eg.bull_case = eg.bull_case ? [String(eg.bull_case)] : [];
    if (!Array.isArray(eg.bear_case)) eg.bear_case = eg.bear_case ? [String(eg.bear_case)] : [];
    if (!eg.key_metrics || typeof eg.key_metrics !== "object") eg.key_metrics = {};
  }

  return parsed as ResearchData;
}

/**
 * When JSON.parse + normalize already succeeded for shape, but tryParseResearchJson
 * failed earlier — OR when parseLooseJson returned a plain object: coerce minimal fields
 * then finalize so InvestmentBrief can render instead of raw JSON.
 */
export function tryHydrateResearchFromLooseObject(raw: unknown): ResearchData | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;

  let parsed: any;
  try {
    parsed = JSON.parse(JSON.stringify(raw));
  } catch {
    return null;
  }

  const jsonHint = JSON.stringify(parsed);
  const isZhHint = /[\u4e00-\u9fff]/.test(jsonHint);

  liftResearchGraphShape(parsed);
  coerceQueryUnderstanding(parsed);

  const hasResearchShape =
    (parsed.query_understanding && typeof parsed.query_understanding === "object") ||
    (Array.isArray(parsed.modules) && parsed.modules.length > 0) ||
    (parsed.evidence_graph && typeof parsed.evidence_graph === "object") ||
    parsed.Analysis_Decision ||
    parsed.investment_decision ||
    (typeof parsed.final_summary === "string" && parsed.final_summary.trim()) ||
    (Array.isArray(parsed.key_insights) && parsed.key_insights.length > 0);

  if (!hasResearchShape) return null;

  if (!parsed.query_understanding || typeof parsed.query_understanding !== "object") {
    if (!synthesizeMissingResearchParts(parsed)) {
      parsed.query_understanding = {
        intent: String(parsed.primary_focus || "Equity research"),
        tickers: Array.isArray(parsed.tickers) ? parsed.tickers.map(String) : [],
        data_sources_used: Array.isArray(parsed.required_data)
          ? parsed.required_data.map(String)
          : [],
        reasoning:
          (typeof parsed.final_summary === "string" && parsed.final_summary.slice(0, 400)) ||
          (Array.isArray(parsed.key_insights) ? parsed.key_insights.slice(0, 3).join(" ").slice(0, 400) : "") ||
          "Derived from structured model output.",
      };
    }
  }

  if (!Array.isArray(parsed.modules) || parsed.modules.length === 0) {
    if (!synthesizeMissingResearchParts(parsed)) {
      const glue =
        (typeof parsed.final_summary === "string" && parsed.final_summary.trim() && parsed.final_summary) ||
        (Array.isArray(parsed.key_insights) ? parsed.key_insights.map(String).filter(Boolean).join("\n\n") : "");
      if (!glue.trim()) return null;
      parsed.modules = [
        {
          module: "Analysis",
          icon: "📋",
          rating: "NEUTRAL",
          reasoning_steps: [glue.length > 4000 ? `${glue.slice(0, 4000)}…` : glue],
          conclusion: glue.length > 4000 ? glue.slice(4000) : glue.slice(0, 800),
          sources: [],
        },
      ];
    }
  }

  if (!parsed.query_understanding || typeof parsed.query_understanding !== "object") return null;
  if (!Array.isArray(parsed.modules) || parsed.modules.length === 0) return null;

  return finalizeParsedResearchToData(parsed, isZhHint);
}

export function tryParseResearchJson(content: string): ResearchData | null {
  const trimmed = preprocessResearchJsonContent(content);
  if (!trimmed.length) return null;

  const isZhHint = /[\u4e00-\u9fff]/.test(trimmed);

  const normalize = (parsed: any): ResearchData | null => {
    liftResearchGraphShape(parsed);
    coerceQueryUnderstanding(parsed);

    if (Array.isArray(parsed)) {
      return null;
    }

    if (!parsed.query_understanding || typeof parsed.query_understanding !== "object") {
      if (!synthesizeMissingResearchParts(parsed)) return null;
    } else if (!Array.isArray(parsed.modules) || parsed.modules.length === 0) {
      if (!synthesizeMissingResearchParts(parsed)) return null;
    }

    if (!parsed.query_understanding || typeof parsed.query_understanding !== "object") {
      return null;
    }
    if (!Array.isArray(parsed.modules) || parsed.modules.length === 0) return null;

    return finalizeParsedResearchToData(parsed, isZhHint);
  };

  const tryParse = (s: string): ResearchData | null => {
    let root: unknown;
    try {
      root = JSON.parse(s);
    } catch {
      try {
        root = JSON.parse(repairJson(s));
      } catch {
        try {
          root = JSON.parse(jsonrepair(s));
        } catch {
          return null;
        }
      }
    }
    if (Array.isArray(root)) {
      const firstObj = root.find((x) => x && typeof x === "object" && !Array.isArray(x));
      if (!firstObj) return null;
      root = firstObj;
    }
    if (!root || typeof root !== "object" || Array.isArray(root)) return null;
    return normalize(root);
  };

  const extracted = extractFirstJsonValue(trimmed);
  const chunks = [...new Set([extracted, trimmed].filter((c): c is string => Boolean(c && c.length)))];

  for (const chunk of chunks) {
    const parsed = tryParse(chunk);
    if (parsed) return parsed;
  }

  const loose = parseLooseJson(trimmed);
  if (loose !== null && typeof loose === "object") {
    const hydrated = tryHydrateResearchFromLooseObject(loose);
    if (hydrated) return hydrated;
  }

  return null;
}

// ─── Style maps ───────────────────────────────────────────────────────────────

// Green: bullish / positive signals
const RATING_GREEN = "bg-green-100 text-green-700 border border-green-300";
// Red: bearish / negative signals
const RATING_RED = "bg-red-100 text-red-700 border border-red-300";
// Yellow: neutral / uncertain signals
const RATING_YELLOW = "bg-yellow-100 text-yellow-700 border border-yellow-300";
// Gray: inconclusive / no data
const RATING_GRAY = "bg-gray-100 text-gray-500 border border-gray-300";
// Blue: fair / average signals
const RATING_BLUE = "bg-blue-100 text-blue-700 border border-blue-300";

const RATING_STYLES: Record<string, string> = {
  // Legacy values
  BULLISH: RATING_GREEN,
  BEARISH: RATING_RED,
  NEUTRAL: RATING_YELLOW,
  INCONCLUSIVE: RATING_GRAY,
  // News Analyst
  POSITIVE: RATING_GREEN,
  NEGATIVE: RATING_RED,
  // Rumor Check
  VERIFIED: RATING_GREEN,
  UNCERTAIN: RATING_YELLOW,
  MISLEADING: RATING_RED,
  // Earnings Specialist / Data Analyst / Industry Analysis
  STRONG: RATING_GREEN,
  MODERATE: RATING_YELLOW,
  WEAK: RATING_RED,
  // Valuation Expert
  UNDERVALUED: RATING_GREEN,
  FAIR: RATING_BLUE,
  OVERVALUED: RATING_RED,
  // Industry Analysis
  AVERAGE: RATING_YELLOW,
  // Chinese equivalents — News Analyst / FDA Calendar
  利好: RATING_GREEN,
  利空: RATING_RED,
  中性: RATING_YELLOW,
  // Chinese — Rumor Check
  已证实: RATING_GREEN,
  存疑: RATING_YELLOW,
  误导性: RATING_RED,
  // Chinese — Earnings / Data / Industry
  强劲: RATING_GREEN,
  一般: RATING_YELLOW,
  疲弱: RATING_RED,
  // Chinese — Valuation Expert
  低估: RATING_GREEN,
  合理: RATING_BLUE,
  高估: RATING_RED,
};

const VERDICT_GRADIENT: Record<string, string> = {
  BUY: "from-green-700 to-emerald-900",
  "SPECULATIVE BUY": "from-orange-600 to-amber-800",
  买入: "from-green-700 to-emerald-900",
  投机性买入: "from-orange-600 to-amber-800",
  HOLD: "from-slate-600 to-blue-900",
  持有: "from-slate-600 to-blue-900",
  SELL: "from-red-700 to-red-900",
  卖出: "from-red-700 to-red-900",
  AVOID: "from-red-800 to-gray-900",
  回避: "from-red-800 to-gray-900",
};

function getRatingStyle(rating: string): string {
  return RATING_STYLES[rating?.toUpperCase()] ?? RATING_STYLES[rating] ?? RATING_GRAY;
}

function getVerdictGradient(verdict: string): string {
  return VERDICT_GRADIENT[verdict] ?? "from-gray-700 to-gray-900";
}

function extractSourceUrl(source: string): string | null {
  const url = source.match(/https?:\/\/[^\s)\]]+/i)?.[0];
  return url ? url.replace(/[.,;]+$/, "") : null;
}

function SourceCitation({
  source,
  index,
}: {
  source?: string;
  index: number;
}) {
  if (!source) return null;

  const url = extractSourceUrl(source);
  const className =
    "mx-0.5 inline-flex min-w-4 items-center justify-center rounded-full border border-blue-200 bg-blue-50 px-1 text-[10px] font-semibold leading-4 text-blue-700 align-baseline";

  if (url) {
    return (
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className={`${className} hover:border-blue-300 hover:bg-blue-100`}
        title={source}
        aria-label={`Source ${index}`}
      >
        {index}
      </a>
    );
  }

  return (
    <span className={className} title={source} aria-label={`Source ${index}`}>
      {index}
    </span>
  );
}

function CitationGroup({ sources }: { sources?: string[] }) {
  const cleanSources = (sources || []).filter(Boolean).slice(0, 3);
  if (cleanSources.length === 0) return null;

  return (
    <>
      {cleanSources.map((source, index) => (
        <SourceCitation key={`${source}-${index}`} source={source} index={index + 1} />
      ))}
    </>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function AIUnderstanding({
  qu,
  language,
}: {
  qu: ResearchData["query_understanding"];
  language: "en" | "zh";
}) {
  return (
    <div className="bg-gradient-to-r from-indigo-950 to-purple-950 text-white rounded-xl p-4">
      <div className="flex items-center gap-2 mb-3">
        <span className="text-sm">🧠</span>
        <span className="font-bold text-xs uppercase tracking-widest text-indigo-300">
          {language === "zh" ? "AI 理解" : "AI Understanding"}
        </span>
      </div>

      {/* Intent + tickers */}
      <div className="flex flex-wrap items-center gap-2 mb-2">
        <span className="text-indigo-400 text-xs font-semibold shrink-0">
          {language === "zh" ? "意图：" : "Intent:"}
        </span>
        {qu.tickers.map((t) => (
          <span
            key={t}
            className="bg-indigo-500 text-white px-2 py-0.5 rounded-full text-xs font-bold"
          >
            {t}
          </span>
        ))}
        <span className="text-white/90 text-xs">{qu.intent}</span>
      </div>

      {/* Data sources */}
      <div className="flex flex-wrap gap-1.5 mb-2">
        {qu.data_sources_used.map((src) => (
          <span
            key={src}
            className="bg-indigo-800/60 text-indigo-200 px-2 py-0.5 rounded text-xs border border-indigo-700"
          >
            {src}
          </span>
        ))}
      </div>

      {/* Reasoning */}
      {qu.reasoning && (
        <p className="text-indigo-200/80 text-xs italic leading-relaxed">
          {qu.reasoning}
        </p>
      )}
    </div>
  );
}

function ModuleCard({ mod }: { mod: ResearchModule }) {
  const ratingStyle = getRatingStyle(mod.rating);

  return (
    <div className="bg-white border border-gray-200 rounded-xl p-3 shadow-sm flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-1.5 min-w-0">
          <span className="text-base shrink-0">{mod.icon}</span>
          <span className="font-semibold text-gray-800 text-xs truncate">
            {mod.module}
          </span>
        </div>
        <span
          className={`text-xs font-bold px-2 py-0.5 rounded-full shrink-0 ml-1 ${ratingStyle}`}
        >
          {mod.rating}
        </span>
      </div>

      {/* Reasoning steps */}
      <ul className="space-y-1 mb-2 flex-1">
        {(mod.reasoning_steps ?? []).map((step, j) => (
          <li key={j} className="flex gap-1.5 text-xs text-gray-600 leading-relaxed">
            <span className="text-gray-400 mt-0.5 shrink-0">•</span>
            <div className="flex-1">
              <SafeHtmlContent html={step} />
              <SourceCitation
                source={mod.sources?.[j % Math.max(mod.sources?.length || 1, 1)]}
                index={(j % Math.max(mod.sources?.length || 1, 1)) + 1}
              />
            </div>
          </li>
        ))}
      </ul>

      {/* Conclusion */}
      <div className="text-xs text-gray-500 italic leading-relaxed border-t border-gray-100 pt-2">
        <SafeHtmlContent html={mod.conclusion} />
        <CitationGroup sources={mod.sources} />
      </div>

      {/* Sources */}
      {mod.sources?.length > 0 && (
        <div className="flex flex-wrap gap-1 mt-2">
          {mod.sources.map((src, k) => (
            <span
              key={k}
              className="bg-gray-100 text-gray-400 px-1.5 py-0.5 rounded text-xs border border-gray-200"
            >
              {src}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function EvidenceGraphSection({
  eg,
  language,
}: {
  eg: EvidenceGraph;
  language: "en" | "zh";
}) {
  const hasMetrics = eg.key_metrics && Object.keys(eg.key_metrics).length > 0;

  return (
    <div>
      <h3 className="text-xs font-bold uppercase tracking-wider text-gray-400 mb-2">
        {language === "zh" ? "证据图谱" : "Evidence Graph"}
      </h3>

      <div className="grid grid-cols-2 gap-3 mb-3">
        {/* Bull */}
        <div className="bg-green-50 border border-green-200 rounded-xl p-3">
          <div className="flex items-center gap-1 mb-2">
            <span className="text-green-600 font-bold text-xs">▲</span>
            <span className="font-bold text-green-700 text-xs uppercase tracking-wide">
              {language === "zh" ? "多头论据" : "Bull Case"}
            </span>
          </div>
          <ul className="space-y-1">
            {(eg.bull_case ?? []).map((pt, i) => (
              <li key={i} className="flex gap-1.5 text-xs text-gray-700 leading-relaxed">
                <span className="text-green-500 shrink-0 font-bold">+</span>
                <SafeHtmlContent html={pt} className="flex-1" />
              </li>
            ))}
          </ul>
        </div>

        {/* Bear */}
        <div className="bg-red-50 border border-red-200 rounded-xl p-3">
          <div className="flex items-center gap-1 mb-2">
            <span className="text-red-600 font-bold text-xs">▼</span>
            <span className="font-bold text-red-700 text-xs uppercase tracking-wide">
              {language === "zh" ? "空头论据" : "Bear Case"}
            </span>
          </div>
          <ul className="space-y-1">
            {(eg.bear_case ?? []).map((pt, i) => (
              <li key={i} className="flex gap-1.5 text-xs text-gray-700 leading-relaxed">
                <span className="text-red-500 shrink-0 font-bold">−</span>
                <SafeHtmlContent html={pt} className="flex-1" />
              </li>
            ))}
          </ul>
        </div>
      </div>

      {/* Key Metrics */}
      {hasMetrics && (
        <div className="flex flex-wrap gap-2">
          {Object.entries(eg.key_metrics).map(([key, val]) => (
            <div
              key={key}
              className="bg-gray-100 border border-gray-200 rounded-lg px-3 py-1.5 text-center"
            >
              <div className="text-xs text-gray-400 uppercase tracking-wide">{key}</div>
              <div className="font-bold text-gray-800 text-sm">{val}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function InvestmentDecisionSection({
  id,
  language,
}: {
  id: InvestmentDecision;
  language: "en" | "zh";
}) {
  const gradient = getVerdictGradient(id.verdict);
  const upsidePositive =
    id.upside_downside &&
    (id.upside_downside.startsWith("+") || id.upside_downside.startsWith("＋"));

  return (
    <div>
      <h3 className="text-xs font-bold uppercase tracking-wider text-gray-400 mb-2">
        {language === "zh" ? "投资决策" : "Investment Decision"}
      </h3>

      <div className={`bg-gradient-to-br ${gradient} text-white rounded-xl p-4`}>
        {/* Verdict row */}
        <div className="flex flex-wrap items-start justify-between gap-3 mb-3">
          <div>
            <div className="flex flex-wrap items-center gap-2 mb-1">
              <span className="text-lg font-black uppercase tracking-wide">
                {id.verdict}
              </span>
              <span className="bg-white/20 border border-white/30 text-white px-2 py-0.5 rounded-full text-xs font-semibold">
                {id.conviction}{" "}
                {language === "zh" ? "确信度" : "Conviction"}
              </span>
            </div>
            {id.time_horizon && (
              <div className="text-xs text-white/70 font-medium">
                {language === "zh" ? "时间跨度：" : "Time Horizon: "}
                {id.time_horizon}
              </div>
            )}
          </div>

          {/* Price targets */}
          <div className="flex gap-4 text-right shrink-0">
            <div>
              <div className="text-white/60 text-xs mb-0.5">
                {language === "zh" ? "当前价" : "Current"}
              </div>
              <div className="font-bold text-sm">{id.current_price}</div>
            </div>
            <div>
              <div className="text-white/60 text-xs mb-0.5">
                {language === "zh" ? "目标价" : "Target"}
              </div>
              <div className="font-bold text-sm">{id.price_target}</div>
            </div>
            <div>
              <div className="text-white/60 text-xs mb-0.5">
                {language === "zh" ? "空间" : "Upside"}
              </div>
              <div
                className={`font-bold text-sm ${
                  upsidePositive ? "text-green-300" : "text-red-300"
                }`}
              >
                {id.upside_downside}
              </div>
            </div>
          </div>
        </div>

        {/* Summary */}
        <div className="text-xs text-white/90 leading-relaxed mb-3">
          <SafeHtmlContent html={id.summary} />
        </div>

        {/* Disclaimer */}
        <div className="text-xs text-white/50 italic border-t border-white/20 pt-2">
          {id.risk_disclaimer}
        </div>
      </div>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

interface ResearchOutputProps {
  data: ResearchData;
  language?: "en" | "zh";
}

export const ResearchOutput: React.FC<ResearchOutputProps> = ({
  data,
  language = "en",
}) => {
  const { query_understanding, modules, evidence_graph, investment_decision } = data;

  return (
    <div className="research-output space-y-4 text-sm w-full">
      {/* 1. AI Understanding */}
      <AIUnderstanding qu={query_understanding} language={language} />

      {/* 2. Analyst Modules */}
      {modules.length > 0 && (
        <div>
          <h3 className="text-xs font-bold uppercase tracking-wider text-gray-400 mb-2">
            {language === "zh" ? "分析师模块" : "Analyst Modules"}
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {modules.map((mod, i) => (
              <ModuleCard key={i} mod={mod} />
            ))}
          </div>
        </div>
      )}

      {/* 3. Evidence Graph */}
      {evidence_graph &&
        (evidence_graph.bull_case?.length > 0 ||
          evidence_graph.bear_case?.length > 0) && (
          <EvidenceGraphSection eg={evidence_graph} language={language} />
        )}

      {/* 4. Investment Decision */}
      {investment_decision?.verdict && (
        <InvestmentDecisionSection id={investment_decision} language={language} />
      )}
    </div>
  );
};

export default ResearchOutput;
