// DRILL_IN (turn_kind Phase 4b-2) — "drill into ONE row of the active list".
//
// Two list-reference triggers, both located in TS BEFORE classification:
//   • ordinal      — "第六个" / "the first one" / "the 2nd stock": the classifier cannot
//                    map an ordinal to a ticker (there is no entity in the text), so the
//                    resolver MUST locate it from view.items[N-1]. Supported single
//                    lenses stay zero-prompt; other intents classify after ticker rebase.
//   • bare member  — a single active-list ticker symbol with NO explicit lens ("BFLY",
//                    "再说说 BFLY"): a deterministic "why it moved + price" drill instead
//                    of a classifier overview guess.
//
// The lens comes from the DrillPlanFactory (buildDrillPlan), NOT inherited from the parent
// turn (a TRENDING drill must NOT re-fetch TRENDING). An EXPLICIT lens in the query ("第六
// 个的估值") always overrides the factory default. The factory reads activeList.origin
// (the build-turn's source/apiParams) — never a priorFrame, which a prior drill may have
// overwritten. See docs/TURN_KIND_PHASE_4B_PLAN.md §4-2 + 接线-3.
//
// This module only LOCATES + PLANS. The parent list is preserved by the normal commit
// (activeListTransitionFor → member_reference, since the drilled ticker ∈ the list), and
// the answer runs through the standard answer-turn path — exactly like set_choice execute.
import type { ListItem, ListSnapshot, ListView } from "@shared/listSnapshot";
import type { ActiveListState } from "./conversation";
import { SET_ANAPHOR_RE } from "./turnKind";
import {
  EXPLICIT_LIST_PIVOT_RE,
  explicitOutsideTicker,
  queryNamesView,
  routableViews,
  selectView,
} from "./listChoice";

/** The single source the user named when they want a SPECIFIC lens (overrides the factory
 *  default). Kept small + deterministic; anything else defers to normal classification. */
export type DrillLens = "VALUATION" | "RATING" | "PERFORMANCE" | "NEWS" | "STOCK_PRICE";

export type DrillAction =
  | { kind: "none" }
  // Ambiguous ordinal (≥2 coexisting views, no list named) or an ordinal beyond the view:
  // a deterministic message, no fetch. reason drives the turn-decision trace.
  | { kind: "clarify"; reason: "ambiguous_view" | "out_of_range"; message: string }
  // A located drill target + its synthetic single-ticker plan (run via the answer path).
  | {
      kind: "drill";
      view: ListView;
      item: ListItem & { ticker: string };
      classification: Record<string, any>;
      effectiveQuery: string;
    }
  // The ordinal was located, but its requested lens is outside the deterministic drill
  // matrix. Re-run normal classification with the resolved ticker made explicit.
  | {
      kind: "classify";
      view: ListView;
      item: ListItem & { ticker: string };
      effectiveQuery: string;
    };

// ── ordinal parsing ────────────────────────────────────────────────────────────
const CN_NUM: Record<string, number> = {
  一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10,
};
const EN_WORD: Record<string, number> = {
  first: 1, second: 2, third: 3, fourth: 4, fifth: 5,
  sixth: 6, seventh: 7, eighth: 8, ninth: 9, tenth: 10,
};
// Chinese needs a measure word (个/只/名/位/支/家) so "第一季度/第三方" never matches.
const CN_ORDINAL_RE = /第\s*([一二两三四五六七八九十]|\d{1,2})\s*(?:个|只|名|位|支|家)/;
// English needs a list noun (one/stock/name/company/ticker/pick) so "first quarter/half"
// never matches; a DIGIT needs the ordinal suffix (st/nd/rd/th) so a cardinal "3 stocks"
// is not read as "the 3rd stock".
const EN_ORDINAL_RE =
  /\b(?:the\s+)?(first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|\d{1,2}(?:st|nd|rd|th))\s+(?:one|stock|name|company|ticker|pick)\b/i;

/** 1-based ordinal the query points at within a list, or null. Exported so computed-RECALL
 *  can defer ordinal queries ("第一个涨最多") to this DRILL resolver instead of argmax. */
export function parseOrdinal(query: string): number | null {
  const cn = CN_ORDINAL_RE.exec(query);
  if (cn) {
    const tok = cn[1];
    return /\d/.test(tok) ? Number(tok) : (CN_NUM[tok] ?? null);
  }
  const en = EN_ORDINAL_RE.exec(query);
  if (en) {
    const tok = en[1].toLowerCase();
    return /\d/.test(tok) ? parseInt(tok, 10) : (EN_WORD[tok] ?? null); // "3rd" → 3
  }
  return null;
}

// ── explicit lens detection (overrides the factory default) ─────────────────────
/** The supported single source the user explicitly named, or null. Order matters
 *  (valuation before the broader fundamentals/performance bucket). */
export function detectDrillLens(query: string): DrillLens | null {
  if (/\bvaluation\b|估值|fair\s*value|值多少钱/i.test(query)) return "VALUATION";
  if (/\brating\b|评级|分析师评/i.test(query)) return "RATING";
  if (/\b(?:fundamentals?|performance|financials?)\b|基本面|业绩|财务/i.test(query)) return "PERFORMANCE";
  if (/\bnews\b|新闻|消息|催化/i.test(query)) return "NEWS";
  if (/\b(?:current\s+)?price\b|股价|现价|价格|多少钱/i.test(query)) return "STOCK_PRICE";
  return null;
}

// ── DrillPlanFactory (the documented (view, ticker, activeList) signature) ───────
interface DrillPlanShape {
  requiredData: string[];
  primaryFocus: string;
  apiParams: Record<string, unknown>;
}

/** Default drill lens for a list row, by the list's ORIGIN (not the latest lens, which a
 *  prior drill may have changed): a trending mover → why it moved + live price
 *  (NEWS + STOCK_PRICE); a picker score-off → re-score that one ticker (STOCK_PICKER).
 *  required_data comes from HERE — never inherited (a TRENDING drill must not re-fetch
 *  TRENDING). MARKET_DATA date inheritance via activeList.origin.apiParams is a later
 *  adapter (接线-4); origin is already threaded for it. */
export function buildDrillPlan(
  view: ListView,
  ticker: string,
  activeList: ActiveListState,
  language: "en" | "zh",
): DrillPlanShape {
  const src = activeList.origin.source;
  const isScoreOff = src === "STOCK_PICKER" && !view.id.startsWith("trending");
  if (isScoreOff) {
    return {
      requiredData: ["STOCK_PICKER"],
      primaryFocus: "STOCK_PICKER",
      apiParams: { STOCK_PICKER: { tickers: [ticker], query: `${ticker} analysis`, lang: language } },
    };
  }
  return {
    requiredData: ["NEWS", "STOCK_PRICE"],
    primaryFocus: "NEWS",
    apiParams: {
      NEWS: { query: `${ticker} latest news and what is driving the move`, language },
      STOCK_PRICE: { ticker },
    },
  };
}

/** Single-source plan for an explicitly named lens (overrides buildDrillPlan). */
function lensPlan(lens: DrillLens, ticker: string, language: "en" | "zh"): DrillPlanShape {
  switch (lens) {
    case "VALUATION":
      return { requiredData: ["VALUATION"], primaryFocus: "VALUATION", apiParams: { VALUATION: { ticker, query: `${ticker} valuation` } } };
    case "RATING":
      return { requiredData: ["RATING"], primaryFocus: "RATING", apiParams: { RATING: { ticker } } };
    case "PERFORMANCE":
      return { requiredData: ["PERFORMANCE"], primaryFocus: "PERFORMANCE", apiParams: { PERFORMANCE: { tickers: [ticker], query: `${ticker} fundamentals` } } };
    case "NEWS":
      return { requiredData: ["NEWS"], primaryFocus: "NEWS", apiParams: { NEWS: { query: `${ticker} latest news catalysts`, language } } };
    case "STOCK_PRICE":
      return { requiredData: ["STOCK_PRICE"], primaryFocus: "STOCK_PRICE", apiParams: { STOCK_PRICE: { ticker } } };
  }
}

function effectiveDrillQuery(ticker: string, name: string, lens: DrillLens | null, language: "en" | "zh"): string {
  const label = name && name !== ticker ? `${name} (${ticker})` : ticker;
  const zhLabel = name && name !== ticker ? `${name}（${ticker}）` : ticker;
  if (!lens) {
    return language === "zh"
      ? `${zhLabel}最近为什么这样走，现价是多少？`
      : `Why is ${label} moving, and what is its current price?`;
  }
  const phrase: Record<DrillLens, { en: string; zh: string }> = {
    VALUATION: { en: "valuation", zh: "估值" },
    RATING: { en: "analyst rating", zh: "分析师评级" },
    PERFORMANCE: { en: "fundamentals", zh: "基本面" },
    NEWS: { en: "latest news", zh: "最新消息" },
    STOCK_PRICE: { en: "current price", zh: "现价" },
  };
  return language === "zh" ? `${zhLabel}的${phrase[lens].zh}如何？` : `What is ${label}'s ${phrase[lens].en}?`;
}

function buildDrill(
  view: ListView,
  item: ListItem & { ticker: string },
  activeList: ActiveListState,
  lens: DrillLens | null,
  language: "en" | "zh",
): DrillAction {
  const ticker = item.ticker;
  const shape = lens ? lensPlan(lens, ticker, language) : buildDrillPlan(view, ticker, activeList, language);
  const classification: Record<string, any> = {
    tickers: [ticker],
    required_data: shape.requiredData,
    primary_focus: shape.primaryFocus,
    api_params: shape.apiParams,
    need_api: true,
    confidence: 1,
    reasoning: `Deterministic DRILL_IN into ${ticker} from the active ${activeList.origin.source} list.`,
  };
  return { kind: "drill", view, item, classification, effectiveQuery: effectiveDrillQuery(ticker, item.name, lens, language) };
}

// ── view selection for an ordinal ────────────────────────────────────────────────
/** Pick the view an ordinal applies to: the named list (alias) or the sole routable view;
 *  "ambiguous" when ≥2 coexist with no list named; null when none is routable. */
function selectOrdinalView(query: string, list: ListSnapshot): ListView | "ambiguous" | null {
  const routable = routableViews(list);
  if (routable.length === 0) return null;
  const view = selectView(query, list); // alias match, or the single routable view
  if (view) return view;
  // An explicitly named, absent view is a fresh-list request, not an ambiguous reference
  // to one of the views already on screen. Defer so normal classification can fetch it.
  return queryNamesView(query) ? null : "ambiguous";
}

function clarifyAmbiguousView(list: ListSnapshot, language: "en" | "zh"): string {
  const labels = routableViews(list).map((v) => v.label || v.id).join(language === "zh" ? "、" : ", ");
  return language === "zh"
    ? `你指的是哪张榜的那一只？当前有：${labels}。`
    : `Which list do you mean? Available views: ${labels}.`;
}

function clarifyOutOfRange(view: ListView, n: number, language: "en" | "zh"): string {
  const count = view.items.filter((i) => i.ticker).length;
  const label = view.label || view.id;
  return language === "zh"
    ? `${label}里只有 ${count} 只股票，没有第 ${n} 只。`
    : `${label} only has ${count} stocks, so there is no #${n}.`;
}

/** The first active-list row whose ticker the query names — but ONLY when exactly one
 *  member is named and no outside ticker appears (≥2 members = a comparison, not a drill). */
function bareMemberTarget(query: string, list: ListSnapshot): { view: ListView; item: ListItem & { ticker: string } } | null {
  const byTicker = new Map<string, { view: ListView; item: ListItem & { ticker: string } }>();
  for (const view of list.views) {
    for (const item of view.items) {
      if (item.ticker && !byTicker.has(item.ticker.toUpperCase())) {
        byTicker.set(item.ticker.toUpperCase(), { view, item: item as ListItem & { ticker: string } });
      }
    }
  }
  const tokens = [...new Set(query.toUpperCase().match(/\b[A-Z]{1,5}\b/g) ?? [])];
  const named = tokens.filter((t) => byTicker.has(t));
  if (named.length !== 1) return null; // 0 → not a ticker ref; ≥2 → a comparison
  if (explicitOutsideTicker(query, list)) return null; // a pivot/comparison with a non-member
  return byTicker.get(named[0])!;
}

/** True only for a generic expansion or one supported single-lens request after removing
 *  its list reference. Any remaining semantic words (buy, moat, market cap, earnings
 *  call, ...) belong to normal classification. */
function isDeterministicDrillRequest(
  query: string,
  reference: "ordinal" | string,
  lens: DrillLens | null,
): boolean {
  let remainder = query;
  if (reference === "ordinal") {
    remainder = remainder.replace(CN_ORDINAL_RE, " ").replace(EN_ORDINAL_RE, " ");
  } else {
    const escaped = reference.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    remainder = remainder.replace(new RegExp(`\\b${escaped}\\b`, "ig"), " ");
  }
  switch (lens) {
    case "VALUATION":
      remainder = remainder.replace(/\bvaluation\b|估值|fair\s*value|值多少钱/gi, " ");
      break;
    case "RATING":
      remainder = remainder.replace(/\banalyst\s+rating\b|\brating\b|评级|分析师评/gi, " ");
      break;
    case "PERFORMANCE":
      remainder = remainder.replace(/\b(?:fundamentals?|performance|financials?)\b|基本面|业绩|财务/gi, " ");
      break;
    case "NEWS":
      remainder = remainder.replace(/\bnews\b|新闻|消息|催化/gi, " ");
      break;
    case "STOCK_PRICE":
      remainder = remainder.replace(/\b(?:current\s+)?price\b|股价|现价|价格|多少钱/gi, " ");
      break;
    case null:
      break;
  }
  remainder = remainder
    .replace(/\b(?:top\s+)?(?:gainers?|losers?)\b|\bmost\s+(?:active|discussed)\b|涨幅榜|跌幅榜|活跃榜|热门榜|领涨|领跌|最活跃|讨论最多/gi, " ")
    .replace(/\b(?:tell|me|more|about|on|what|how|please|details?|expand|drill|into|go|deeper|stock|company|which|of|these|them|among|is|the)\b/gi, " ")
    .replace(/其中|这些|这几只|那几只|再|继续|详细|展开|深入|说说|讲讲|看看|聊聊|怎么样|如何|咋样|呢|吧|请|帮我|关于|这只|这个|股票|的/g, " ")
    .replace(/[\s\p{P}\p{S}]/gu, "");
  return remainder.length === 0;
}

function effectiveClassificationQuery(
  item: ListItem & { ticker: string },
  query: string,
  language: "en" | "zh",
): string {
  const label = item.name && item.name !== item.ticker
    ? language === "zh" ? `${item.name}（${item.ticker}）` : `${item.name} (${item.ticker})`
    : item.ticker;
  return language === "zh" ? `关于${label}：${query}` : `Regarding ${label}: ${query}`;
}

/**
 * Resolve a DRILL_IN over the active list. Ordinal → locate by index;
 * a bare member symbol with no explicit lens → locate by ticker. An explicit lens always
 * overrides the factory default; a bare member WITH a lens is deferred to the classifier
 * ("BFLY valuation" routes fine + member_reference preserves the list). A set-anaphor
 * without an ordinal stays with set-screen / set_choice; explicit list pivots defer.
 */
export function resolveDrill(
  query: string,
  activeList: ActiveListState | undefined,
  language: "en" | "zh",
): DrillAction {
  if (!activeList) return { kind: "none" };
  const list = activeList.list;
  if (EXPLICIT_LIST_PIVOT_RE.test(query)) return { kind: "none" };

  const lens = detectDrillLens(query);

  const n = parseOrdinal(query);
  // A plural set reference without an ordinal stays with set-screen / set_choice. With
  // an ordinal ("其中第一个"), it is precisely the scope anchor for this resolver.
  if (n === null && SET_ANAPHOR_RE.test(query)) return { kind: "none" };
  if (n !== null) {
    const view = selectOrdinalView(query, list);
    if (view === "ambiguous") return { kind: "clarify", reason: "ambiguous_view", message: clarifyAmbiguousView(list, language) };
    if (!view) return { kind: "none" };
    const located = view.items[n - 1];
    if (!located) return { kind: "clarify", reason: "out_of_range", message: clarifyOutOfRange(view, n, language) };
    if (!located.ticker) return { kind: "none" }; // a name-only score row can't be drilled → defer
    const item = located as ListItem & { ticker: string };
    if (isDeterministicDrillRequest(query, "ordinal", lens)) {
      return buildDrill(view, item, activeList, lens, language);
    }
    return { kind: "classify", view, item, effectiveQuery: effectiveClassificationQuery(item, query, language) };
  }

  // Bare member reference — only the no-lens case (a named lens defers to the classifier).
  if (!lens) {
    const target = bareMemberTarget(query, list);
    if (target && isDeterministicDrillRequest(query, target.item.ticker, null)) {
      return buildDrill(target.view, target.item, activeList, null, language);
    }
  }
  return { kind: "none" };
}
