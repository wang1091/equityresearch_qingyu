// computed RECALL (turn_kind Phase 4b-1) — answer a superlative over the active list
// FROM THE NUMBERS ALREADY ON SCREEN, with ZERO fetch. "(其中)涨最多的是哪只" /
// "which gained the most" / "评分最高的" → argmax/argmin over view.items[].metrics.
//
// Scope: a superlative over a field the list ALREADY carries — changePercent (trending) and
// finalScore (a STOCK_PICKER score-off) — is answered with ZERO fetch (argmax/argmin).
//
// A superlative over a field NOT in the snapshot ("其中市值最大" / "业绩最强" / "估值最低") is
// a REFINE_SET: we MATERIALIZE the candidate tickers from the bound view and re-classify an
// explicit-ticker query, so the classifier routes it to the right source (MARKET_DATA /
// PERFORMANCE / VALUATION) and — crucially — runs it through normalize, where the
// time-guard reroute fires (a date-modified fundamentals superlative → EARNINGS, never a
// date-blind PERFORMANCE). The parent list is preserved. The PERFORMANCE boundary is sealed
// (normalize.ts reroute + service.ts ?peers=), so this fan-out is safe.
//
// Binding: a strong set-anaphor ("其中/of these") locks the list; a bare predicate
// ("涨最多呢") binds only as weak ellipsis — its implied view-semantic (gainer→top_gainers)
// must resolve to a present view, otherwise it stays ambiguous (strong → clarify, weak →
// defer). An explicit list pivot always defers. Ordinals are DRILL's job, not argmax.
//
// Like set_choice momentum, this is a committable short-circuit: the answer is deterministic
// text + a preserved parent list; compute replaces focus with the winner, while
// empty_domain preserves focus but records its honest conclusion. See plan §4-1.
import type { ListItem, ListSnapshot, ListView } from "@shared/listSnapshot";
import type { ActiveListState, PendingComputed } from "./conversation";
import type { ListEmptyDomainDerivation, ListExtremeDerivation } from "./claim";
import { parseOrdinal } from "./drill";
import { formatSourceLine, SET_ANAPHOR_RE } from "./turnKind";
import { EXPLICIT_LIST_PIVOT_RE, queryNamesView, routableViews, selectView } from "./listChoice";

type Field = "changePercent" | "finalScore";

interface ComputePredicate {
  field: Field;
  direction: "max" | "min";
  /** Only changePercent asserts a sign: a "gainer" needs a positive in the domain, a
   *  "loser" a negative. When the domain has none, that's empty_domain (honest, no label). */
  sign?: "positive" | "negative";
  /** The view this predicate implies, used to pick among coexisting views. */
  semanticViewId?: "top_gainers" | "top_losers";
  phrase: { en: string; zh: string };
}

export type ComputedAction =
  | { kind: "none" }
  | { kind: "clarify"; reason: "ambiguous_view"; message: string; pending: PendingComputed }
  // A located winner over the live numbers — focus moves to it, parent list preserved.
  // derivation freezes the argmax/argmin so JUSTIFY can explain it without re-reading data.
  | { kind: "compute"; answer: string; ticker: string; claim: string; derivation: ListExtremeDerivation }
  // The predicate asserted a direction the domain doesn't contain (all-up asked "跌最多"):
  // an honest statement, NO winner label, everything preserved.
  | { kind: "empty_domain"; answer: string; claim: string; derivation: ListEmptyDomainDerivation }
  // A superlative over a field NOT in the table (market cap / fundamentals / valuation): the
  // candidate set is materialized from the bound view; index.ts re-classifies effectiveQuery
  // (explicit tickers) so the right source is fetched. The parent list is preserved.
  | { kind: "refine_set"; tickers: string[]; effectiveQuery: string };

// ── predicate dictionary ─────────────────────────────────────────────────────────
const HIGH_SCORE_RE =
  /(?:综合)?(?:评分|得分|分数|打分)最高|最高(?:综合)?(?:评分|得分|分)|highest(?:\s+\w+)?\s+score|top\s+score|best[\s-]?rated|highest[\s-]?rated/i;
const LOW_SCORE_RE =
  /(?:综合)?(?:评分|得分|分数|打分)最低|最低(?:综合)?(?:评分|得分|分)|lowest(?:\s+\w+)?\s+score|worst[\s-]?rated|lowest[\s-]?rated/i;
const GAINER_RE =
  /涨[得幅]?最(?:多|大|高)|最(?:多|大)涨幅|涨幅最高|最能涨|biggest\s+gain(?:er)?|largest\s+gain|gain(?:ed|ing)?\s+the\s+most|up\s+the\s+most|best\s+perform(?:er|ing)?/i;
const LOSER_RE =
  /跌[得幅]?最(?:多|大|惨)|最(?:多|大)跌幅|跌幅最高|biggest\s+los(?:er|s)|largest\s+(?:decline|drop|loss)|(?:dropped?|fell|fallen|declined?|down)\s+the\s+most|worst\s+perform(?:er|ing)?/i;

/** Map a superlative phrase to a computable predicate, or null when none applies. Score
 *  before move so "best rated" is a score, while "best performer" stays a gain. */
export function detectComputePredicate(query: string): ComputePredicate | null {
  if (HIGH_SCORE_RE.test(query)) return { field: "finalScore", direction: "max", phrase: { en: "scores highest", zh: "综合评分最高" } };
  if (LOW_SCORE_RE.test(query)) return { field: "finalScore", direction: "min", phrase: { en: "scores lowest", zh: "综合评分最低" } };
  if (GAINER_RE.test(query))
    return { field: "changePercent", direction: "max", sign: "positive", semanticViewId: "top_gainers", phrase: { en: "gained the most", zh: "涨得最多" } };
  if (LOSER_RE.test(query))
    return { field: "changePercent", direction: "min", sign: "negative", semanticViewId: "top_losers", phrase: { en: "fell the most", zh: "跌得最多" } };
  return null;
}

// ── super-table superlatives (REFINE_SET) ────────────────────────────────────────
// Fields NOT carried by the list → can't be argmax'd in place; they scope a fresh fetch.
// Tested AFTER detectComputePredicate so "best performer/涨最多" stays an in-table gain.
const MARKET_CAP_RE = /市值最[大高]|最大市值|largest\s+(?:market\s+)?cap|highest\s+market\s+cap|biggest\s+(?:company|stock)|most\s+valuable/i;
const VALUATION_SUPERLATIVE_RE = /估值最[低高]|最便宜|最贵|cheapest|most\s+expensive|lowest\s+(?:p\/?e|valuation|multiple)|highest\s+(?:p\/?e|valuation|multiple)/i;
const FUNDAMENTALS_SUPERLATIVE_RE = /(?:业绩|基本面|财务|盈利能力)最[强好健佳]|最强(?:的)?(?:业绩|基本面)|strongest\s+(?:fundamentals|performance|financials|earnings)|best\s+fundamentals|healthiest|most\s+profitable/i;

/** Detect a superlative whose ranking field is NOT in the list snapshot. Returns a coarse
 *  label (the classifier picks the actual source on re-classify); null when none applies. */
function detectRefinePredicate(query: string): "market_cap" | "valuation" | "fundamentals" | null {
  if (MARKET_CAP_RE.test(query)) return "market_cap";
  if (VALUATION_SUPERLATIVE_RE.test(query)) return "valuation";
  if (FUNDAMENTALS_SUPERLATIVE_RE.test(query)) return "fundamentals";
  return null;
}

// ── view selection ─────────────────────────────────────────────────────────────
/** Pick a compatible view to compute over. A strong set reference may bind the sole
 *  compatible current view even when its semantic differs (so empty_domain can answer
 *  honestly); weak ellipsis requires the implied semantic to be present. */
function selectComputeView(
  query: string,
  list: ListSnapshot,
  predicate: ComputePredicate,
  strong: boolean,
): ListView | "ambiguous" | null {
  const routable = routableViews(list);
  if (routable.length === 0) return null;

  if (queryNamesView(query)) {
    const named = selectView(query, list);
    return named && finiteEntries(named, predicate.field).length > 0 ? named : null;
  }

  const compatible = routable.filter((view) => finiteEntries(view, predicate.field).length > 0);
  if (compatible.length === 0) return null;
  if (predicate.semanticViewId) {
    const implied = compatible.find((view) => view.id.includes(predicate.semanticViewId!));
    if (implied) return implied;
    if (!strong) return null;
  }
  return compatible.length === 1 ? compatible[0] : "ambiguous";
}

/** Materialize the candidate tickers of the bound view (REFINE_SET). Unlike a compute we
 *  don't require a finite metric — the field isn't in the table, the fetch will supply it.
 *  A named view selects it; a sole routable view binds; coexisting views are ambiguous. */
function materializeSet(query: string, list: ListSnapshot): string[] | "ambiguous" | null {
  const routable = routableViews(list);
  if (routable.length === 0) return null;
  let view: ListView | null = null;
  if (queryNamesView(query)) view = selectView(query, list);
  else if (routable.length === 1) view = routable[0];
  else return "ambiguous";
  if (!view) return null;
  const tickers = [...new Set(view.items.map((i) => i.ticker?.toUpperCase()).filter(Boolean))] as string[];
  return tickers.length >= 2 ? tickers : null;
}

/** Build the explicit-ticker query the classifier re-runs, so the materialized set (not a
 *  classifier re-parse of "其中") drives the fan-out. */
function buildRefineQuery(tickers: string[], query: string, language: "en" | "zh"): string {
  const list = tickers.join(language === "zh" ? "、" : ", ");
  return language === "zh" ? `在 ${list} 中：${query}` : `Among ${list}: ${query}`;
}

/** Resolve a super-table superlative over the bound set. Requires a strong set reference or a
 *  named view (a bare weak super-table phrase defers — we won't re-fetch on a loose ref). */
function resolveRefineSet(query: string, activeList: ActiveListState, language: "en" | "zh"): ComputedAction {
  if (!detectRefinePredicate(query)) return { kind: "none" };
  if (!SET_ANAPHOR_RE.test(query) && !queryNamesView(query)) return { kind: "none" };
  const set = materializeSet(query, activeList.list);
  if (set === null) return { kind: "none" };
  if (set === "ambiguous") {
    return {
      kind: "clarify",
      reason: "ambiguous_view",
      message: clarifyAmbiguousView(activeList.list, language),
      pending: { kind: "computed", stage: "awaiting_view", activeListCapturedAt: activeList.list.capturedAt, query },
    };
  }
  return { kind: "refine_set", tickers: set, effectiveQuery: buildRefineQuery(set, query, language) };
}

function clarifyAmbiguousView(list: ListSnapshot, language: "en" | "zh"): string {
  const labels = routableViews(list).map((v) => v.label || v.id).join(language === "zh" ? "、" : ", ");
  return language === "zh"
    ? `你想看哪张榜里的？当前有：${labels}。`
    : `Which list do you mean? Available views: ${labels}.`;
}

// ── argmax/argmin over the typed metrics ─────────────────────────────────────────
interface Entry {
  item: ListItem & { ticker: string };
  index: number;
  value: number;
}

/** Routable rows whose target metric is a finite number, in view order. */
function finiteEntries(view: ListView, field: Field): Entry[] {
  return view.items
    .map((item, index) => ({ item, index, value: item.metrics[field] }))
    .filter((e): e is Entry => !!e.item.ticker && typeof e.value === "number" && Number.isFinite(e.value));
}

function emptyDomain(missingSign: "positive" | "negative", viewId: string, boundaryTicker: string): ListEmptyDomainDerivation {
  return { kind: "list_empty_domain", viewId, field: "changePercent", missingSign, boundaryTicker };
}

function formatValue(field: Field, v: number): string {
  return field === "changePercent" ? `${v >= 0 ? "+" : ""}${v.toFixed(2)}%` : v.toFixed(0);
}

function itemLabel(item: ListItem & { ticker: string }, language: "en" | "zh"): string {
  const named = item.name && item.name !== item.ticker;
  if (!named) return item.ticker;
  return language === "zh" ? `${item.name}（${item.ticker}）` : `${item.name} (${item.ticker})`;
}

function partialNote(measured: number, total: number, language: "en" | "zh"): string {
  if (measured >= total) return "";
  return language === "zh"
    ? `（仅基于有数据的 ${measured} 只）`
    : ` (based on the ${measured} with data)`;
}

/** A weak predicate must be the whole request, not merely a substring of a fresh subject
 *  question ("which sector gained the most"). Strong set references and named views are
 *  authorized separately. */
function isWeakComputeQuery(query: string, predicate: ComputePredicate): boolean {
  const pattern = predicate.field === "finalScore"
    ? predicate.direction === "max" ? HIGH_SCORE_RE : LOW_SCORE_RE
    : predicate.direction === "max" ? GAINER_RE : LOSER_RE;
  const remainder = query
    .replace(pattern, " ")
    .replace(/\b(?:which|one|stock|company|name|ticker|pick|has|have|had|is|was|were|the|of|who|what|did|does|do|it|today|now|currently|right|please)\b/gi, " ")
    .replace(/其中|这些|这几只|那几只|哪只|哪个|谁|是|的|呢|吗|股票|今天|现在|当前|请|一下|里|里面|中/g, " ")
    .replace(/[\s\p{P}\p{S}]/gu, "");
  return remainder.length === 0;
}

/** Append a compact inline citation to a computed answer. INTENTIONALLY distinct from
 *  answerRecall (turnKind.ts): this is a one-line "by the way, here's the source" footer on
 *  a substantive answer, so it omits the "retrieved at" time that a dedicated RECALL answer
 *  leads with. Different audience, different surface — do NOT merge the two formatters. */
function withSources(answer: string, activeList: ActiveListState, language: "en" | "zh"): string {
  if (activeList.sources.length === 0) return answer;
  const lines = activeList.sources.map((source) => formatSourceLine(source, language === "zh")).join("\n");
  return `${answer}\n\n${language === "zh" ? "来源：" : "Source:"}\n${lines}`;
}

// ── resolver ─────────────────────────────────────────────────────────────────────
/**
 * Resolve a zero-fetch superlative over the active list. Returns none whenever the query
 * is not a computable superlative, the predicate's field is absent from the snapshot, an
 * ordinal is present (DRILL territory), or a weak reference can't bind unambiguously.
 */
export function resolveComputed(
  query: string,
  activeList: ActiveListState | undefined,
  language: "en" | "zh",
  pending?: PendingComputed,
): ComputedAction {
  if (!activeList) return { kind: "none" };
  const livePending = pending?.activeListCapturedAt === activeList.list.capturedAt ? pending : undefined;
  if (EXPLICIT_LIST_PIVOT_RE.test(query)) return { kind: "none" };
  const effectiveQuery = livePending && queryNamesView(query) ? `${livePending.query} ${query}` : query;
  if (parseOrdinal(effectiveQuery) !== null) return { kind: "none" }; // ordinal → DRILL, not argmax

  const predicate = detectComputePredicate(effectiveQuery);
  if (!predicate) return resolveRefineSet(effectiveQuery, activeList, language); // super-table → materialize + re-fetch

  // Binding: strong set-anaphor always binds; a bare predicate is weak ellipsis. Either
  // way the SCOPE is the active list — the difference shows up only on ambiguity below.
  const strong = SET_ANAPHOR_RE.test(effectiveQuery);
  if (!strong && !queryNamesView(effectiveQuery) && !isWeakComputeQuery(effectiveQuery, predicate)) {
    return { kind: "none" };
  }

  const view = selectComputeView(effectiveQuery, activeList.list, predicate, strong);
  if (view === null) return { kind: "none" };
  if (view === "ambiguous") {
    // Strong reference earns a clarification; a weak bare predicate just defers.
    return strong
      ? {
          kind: "clarify",
          reason: "ambiguous_view",
          message: clarifyAmbiguousView(activeList.list, language),
          pending: {
            kind: "computed",
            stage: "awaiting_view",
            activeListCapturedAt: activeList.list.capturedAt,
            query: effectiveQuery,
          },
        }
      : { kind: "none" };
  }

  const entries = finiteEntries(view, predicate.field);
  if (entries.length === 0) return { kind: "none" }; // field not on this view → defer (REFINE_SET later)

  const sorted = [...entries].sort((a, b) =>
    predicate.direction === "max" ? b.value - a.value || a.index - b.index : a.value - b.value || a.index - b.index,
  );
  const winner = sorted[0];
  const routableCount = view.items.filter((i) => i.ticker).length;
  const note = partialNote(entries.length, routableCount, language);
  const label = itemLabel(winner.item, language);
  const valueText = formatValue(predicate.field, winner.value);
  const viewLabel = view.label || view.id;
  // Frozen comparison behind the conclusion — JUSTIFY replays it over the same view.
  const derivation: ListExtremeDerivation = {
    kind: "list_extreme",
    viewId: view.id,
    field: predicate.field,
    direction: predicate.direction,
    winnerTicker: winner.item.ticker,
  };

  // Sign check (changePercent only): the predicate asserted a direction the domain lacks.
  if (predicate.sign === "positive" && !entries.some((e) => e.value > 0)) {
    const conclusion = language === "zh"
      ? `${viewLabel}里这些股票当前都没有上涨；跌得最少的是${label}，${valueText}。${note}`
      : `None of the stocks in ${viewLabel} are up right now; the smallest decline is ${label} at ${valueText}.${note}`;
    return { kind: "empty_domain", answer: withSources(conclusion, activeList, language), claim: conclusion, derivation: emptyDomain("positive", view.id, winner.item.ticker) };
  }
  if (predicate.sign === "negative" && !entries.some((e) => e.value < 0)) {
    const conclusion = language === "zh"
      ? `${viewLabel}里这些股票当前都没有下跌；涨得最少的是${label}，${valueText}。${note}`
      : `None of the stocks in ${viewLabel} are down right now; the smallest gain is ${label} at ${valueText}.${note}`;
    return { kind: "empty_domain", answer: withSources(conclusion, activeList, language), claim: conclusion, derivation: emptyDomain("negative", view.id, winner.item.ticker) };
  }

  const conclusion = language === "zh"
    ? `在${viewLabel}里，${label}${predicate.phrase.zh}，${predicate.field === "changePercent" ? `涨跌幅 ${valueText}` : `评分 ${valueText}`}。${note}`
    : `Within ${viewLabel}, ${label} ${predicate.phrase.en} at ${valueText}.${note}`;
  return {
    kind: "compute",
    answer: withSources(conclusion, activeList, language),
    ticker: winner.item.ticker,
    claim: conclusion,
    derivation,
  };
}
