import type { ListItem, ListSnapshot, ListView } from "@shared/listSnapshot";
import type { PendingSetChoice, SetChoiceCriterion } from "./conversation";
import type { ListExtremeDerivation } from "./claim";

/** A set-choice comparison is deliberately bounded: heavier providers fan out per ticker. */
export const SET_CHOICE_CANDIDATE_LIMIT = 2;

export type ReferenceBinding = "strong_set" | "set_choice" | "ordinal" | "weak_ellipsis" | "none";

export type SetChoiceAction =
  | { kind: "none" }
  | { kind: "clarify"; reason: "view" | "criterion" | "scope"; message: string; pending: PendingSetChoice }
  | {
      kind: "execute";
      criterion: SetChoiceCriterion;
      view: ListView;
      candidates: ListItem[];
      effectiveQuery: string;
    };

const SET_CHOICE_RE =
  /\bwhich\s+(?:one|stock|company|name)\b[^?!.]*(?:buy|choose|pick|invest|worth)|\bwhich\s+of\s+(?:these|them|those)\b[^?!.]*(?:buy|choose|pick|invest|worth)|\bwhat\s+would\s+you\s+(?:buy|pick|choose|invest\s+in)\b|\b(?:is|are)\s+any\s+of\s+these\b[^?!.]*\bworth\b|\bthoughts?\s+on\s+these\b[^?!.]*(?:buy|invest)|哪(?:一)?只[^？。!]*(?:买|选|入手|投资|值得)|哪(?:一)?个[^？。!]*(?:买|选|入手|投资|值得)|我该(?:买|选|入手)哪|这里面.*值得/i;

/** Only explicit switches count. Bare "today" / "other" are intentionally not pivots. */
export const EXPLICIT_LIST_PIVOT_RE =
  /\b(?:forget\s+(?:that|those)|new\s+topic|show\s+(?:me\s+)?(?:another|different)\s+(?:list|set)|show\s+(?:me\s+)?other\s+stocks\s+instead|across\s+the\s+(?:whole\s+)?market)\b|换个话题|换一批|不要刚才那些|重新看全市场/i;

const VIEW_ALIASES: Array<{ re: RegExp; idPart: string }> = [
  { re: /\b(?:top\s+)?gainers?\b|涨幅榜|领涨/, idPart: "top_gainers" },
  { re: /\b(?:top\s+)?losers?\b|跌幅榜|领跌/, idPart: "top_losers" },
  { re: /\bmost\s+active\b|活跃榜|最活跃/, idPart: "most_active" },
  { re: /\bmost\s+discussed\b|热门榜|讨论最多/, idPart: "most_discussed" },
];

export function detectChoiceCriterion(query: string): SetChoiceCriterion | null {
  if (/\b(?:balanced|overall|composite)\b|综合(?:分|评分|比较)?/i.test(query)) return "balanced";
  if (/\bvalu(?:e|ation|ed)\b|估值|便宜|高估|低估/i.test(query)) return "valuation";
  if (/\b(?:fundamentals?|financials?|earnings|cash\s+flow)\b|基本面|财务|业绩|现金流/i.test(query)) return "fundamentals";
  if (/\b(?:momentum|price\s+move|gain|performance\s+today)\b|动量|涨幅|走势|今天表现/i.test(query)) return "momentum";
  if (/\b(?:news|catalysts?|headline)\b|新闻|催化|消息/i.test(query)) return "news";
  return null;
}

/** Views with ≥2 routable (non-null ticker) items — the operable set for a choice/drill. */
export function routableViews(list: ListSnapshot): ListView[] {
  return list.views.filter((view) => view.items.filter((item) => item.ticker).length >= 2);
}

function viewCandidates(view: ListView): ListItem[] {
  return view.items.filter((item): item is ListItem & { ticker: string } => !!item.ticker);
}

/** Whether the query explicitly names one of the supported list views. */
export function queryNamesView(query: string): boolean {
  return VIEW_ALIASES.some(({ re }) => re.test(query));
}

/** Pick the view a follow-up names (by list alias) or the sole routable view. Returns
 *  null for an absent named view or when multiple views coexist without a named match. */
export function selectView(query: string, list: ListSnapshot): ListView | null {
  const views = routableViews(list);
  let namedView = false;
  for (const { re, idPart } of VIEW_ALIASES) {
    if (!re.test(query)) continue;
    namedView = true;
    const matched = views.find((view) => view.id.includes(idPart));
    if (matched) return matched;
  }
  // The user explicitly named a view that is not present. Do not silently bind the
  // sole existing view (e.g. "top losers first" over a top-gainers-only snapshot).
  if (namedView) return null;
  return views.length === 1 ? views[0] : null;
}

function viewById(list: ListSnapshot, viewId: string | undefined): ListView | null {
  return viewId ? list.views.find((view) => view.id === viewId) ?? null : null;
}

/** True when the query names an uppercase ticker token NOT in the active list (a pivot /
 *  comparison with a non-member) — gates set-choice scope and drill membership alike. */
export function explicitOutsideTicker(query: string, list: ListSnapshot): boolean {
  const members = new Set(
    list.views.flatMap((view) => view.items.map((item) => item.ticker?.toUpperCase()).filter(Boolean) as string[]),
  );
  const financeAcronyms = new Set(["I", "DCF", "FCF", "EBIT", "EBITDA", "EPS", "PE", "ROE", "ROIC", "NEWS", "YTD"]);
  const tokens = query.match(/\b[A-Z]{2,5}\b/g) ?? [];
  return tokens.some((token) => !financeAcronyms.has(token) && !members.has(token));
}

function isSetChoice(query: string, list: ListSnapshot): boolean {
  return SET_CHOICE_RE.test(query) && !EXPLICIT_LIST_PIVOT_RE.test(query) && !explicitOutsideTicker(query, list);
}

function criterionLabel(criterion: SetChoiceCriterion, language: "en" | "zh"): string {
  const labels: Record<SetChoiceCriterion, { en: string; zh: string }> = {
    balanced: { en: "balanced score", zh: "综合评分" },
    valuation: { en: "valuation", zh: "估值" },
    fundamentals: { en: "fundamentals", zh: "基本面" },
    momentum: { en: "momentum", zh: "短期动量" },
    news: { en: "news catalysts", zh: "新闻催化" },
  };
  return labels[criterion][language];
}

function clarifyView(list: ListSnapshot, language: "en" | "zh"): string {
  const labels = routableViews(list).map((view) => view.label || view.id).join(language === "zh" ? "、" : ", ");
  return language === "zh"
    ? `你想从哪张榜里选？当前有：${labels}。`
    : `Which list do you want to choose from? Available views: ${labels}.`;
}

function clarifyCriterion(view: ListView, language: "en" | "zh"): string {
  const label = view.label || view.id;
  return language === "zh"
    ? `我可以比较${label}里的股票，但单日涨跌不足以支持买入结论。你想按基本面、估值、短期动量、新闻催化，还是综合评分来比较？`
    : `I can compare the stocks in ${label}, but a one-day move alone is not enough for a buy decision. Should I rank them by fundamentals, valuation, momentum, news catalysts, or a balanced score?`;
}

function clarifyScope(view: ListView, criterion: SetChoiceCriterion, language: "en" | "zh"): string {
  const count = viewCandidates(view).length;
  const label = criterionLabel(criterion, language);
  return language === "zh"
    ? `这张榜有 ${count} 只股票。为控制比较成本，每次最多比较 ${SET_CHOICE_CANDIDATE_LIMIT} 只。请说“前两只”，或直接指定一到两只股票；我会按${label}比较。`
    : `This list has ${count} stocks. To keep the comparison bounded, I can compare at most ${SET_CHOICE_CANDIDATE_LIMIT} at a time. Say “the first two” or name one or two stocks, and I’ll compare them by ${label}.`;
}

function parseScope(query: string, view: ListView): ListItem[] | null {
  const candidates = viewCandidates(view);
  if (/\b(?:first|top)\s+(?:two|2)\b|前两只|前二|头两只/i.test(query)) {
    return candidates.slice(0, SET_CHOICE_CANDIDATE_LIMIT);
  }
  const upper = query.toUpperCase();
  const lower = query.toLowerCase();
  const selected = candidates.filter((item) => {
    const ticker = item.ticker!.toUpperCase();
    const tickerHit = new RegExp(`\\b${ticker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`).test(upper);
    const name = item.name.trim().toLowerCase();
    const nameHit = name.length >= 3 && lower.includes(name);
    return tickerHit || nameHit;
  });
  const unique = selected.filter((item, index) => selected.findIndex((other) => other.ticker === item.ticker) === index);
  return unique.length >= 1 && unique.length <= SET_CHOICE_CANDIDATE_LIMIT ? unique : null;
}

function effectiveQuery(criterion: SetChoiceCriterion, candidates: ListItem[]): string {
  const tickers = candidates.map((item) => item.ticker).join(" and ");
  return `Compare ${tickers} by ${criterion} and explain which looks strongest on that criterion; do not infer a personalized buy recommendation.`;
}

function advance(
  list: ListSnapshot,
  view: ListView,
  criterion: SetChoiceCriterion | null,
  language: "en" | "zh",
): SetChoiceAction {
  if (!criterion) {
    return {
      kind: "clarify",
      reason: "criterion",
      message: clarifyCriterion(view, language),
      pending: {
        kind: "set_choice",
        stage: "awaiting_criterion",
        activeListCapturedAt: list.capturedAt,
        viewId: view.id,
      },
    };
  }
  const candidates = viewCandidates(view);
  // Momentum is a zero-fetch calculation over the typed metrics already in the view.
  // The scope budget exists for remote/generative comparisons, not local sorting.
  if (criterion !== "momentum" && candidates.length > SET_CHOICE_CANDIDATE_LIMIT) {
    return {
      kind: "clarify",
      reason: "scope",
      message: clarifyScope(view, criterion, language),
      pending: {
        kind: "set_choice",
        stage: "awaiting_scope",
        activeListCapturedAt: list.capturedAt,
        viewId: view.id,
        criterion,
      },
    };
  }
  return { kind: "execute", criterion, view, candidates, effectiveQuery: effectiveQuery(criterion, candidates) };
}

/** Resolve a new set-choice or the user's short answer to a prior clarification. */
export function resolveSetChoiceAction(
  query: string,
  list: ListSnapshot | undefined,
  pending: PendingSetChoice | undefined,
  language: "en" | "zh",
): SetChoiceAction {
  if (!list) return { kind: "none" };
  const livePending = pending?.activeListCapturedAt === list.capturedAt ? pending : undefined;
  if (livePending && (EXPLICIT_LIST_PIVOT_RE.test(query) || explicitOutsideTicker(query, list))) {
    return { kind: "none" };
  }

  if (livePending?.stage === "awaiting_view") {
    const view = selectView(query, list);
    if (!view) return { kind: "none" };
    return advance(list, view, livePending.criterion ?? detectChoiceCriterion(query), language);
  }

  if (livePending?.stage === "awaiting_criterion") {
    const view = viewById(list, livePending.viewId);
    const criterion = detectChoiceCriterion(query);
    if (!view || !criterion) return { kind: "none" };
    return advance(list, view, criterion, language);
  }

  if (livePending?.stage === "awaiting_scope") {
    const view = viewById(list, livePending.viewId);
    if (!view || !livePending.criterion) return { kind: "none" };
    const candidates = parseScope(query, view);
    if (!candidates) {
      return /\b(?:all|everyone|every\s+stock)\b|全部|所有|都比较/i.test(query)
        ? { kind: "clarify", reason: "scope", message: clarifyScope(view, livePending.criterion, language), pending: livePending }
        : { kind: "none" };
    }
    return {
      kind: "execute",
      criterion: livePending.criterion,
      view,
      candidates,
      effectiveQuery: effectiveQuery(livePending.criterion, candidates),
    };
  }

  if (!isSetChoice(query, list)) return { kind: "none" };
  const criterion = detectChoiceCriterion(query);
  const view = selectView(query, list);
  if (!view) {
    return {
      kind: "clarify",
      reason: "view",
      message: clarifyView(list, language),
      pending: {
        kind: "set_choice",
        stage: "awaiting_view",
        activeListCapturedAt: list.capturedAt,
        criterion: criterion ?? undefined,
      },
    };
  }
  return advance(list, view, criterion, language);
}

export function buildSetChoiceClassification(
  criterion: Exclude<SetChoiceCriterion, "momentum">,
  candidates: ListItem[],
  effectiveQueryText: string,
  language: "en" | "zh",
): Record<string, any> {
  const tickers = candidates.map((item) => item.ticker).filter((ticker): ticker is string => !!ticker);
  const common = {
    tickers,
    need_api: true,
    confidence: 1,
    reasoning: `Deterministic set_choice ${criterion} over the active list.`,
  };
  if (criterion === "balanced") {
    return {
      ...common,
      required_data: ["STOCK_PICKER"],
      primary_focus: "STOCK_PICKER",
      api_params: { STOCK_PICKER: { tickers, query: effectiveQueryText, lang: language } },
    };
  }
  if (criterion === "valuation") {
    return {
      ...common,
      required_data: ["VALUATION"],
      primary_focus: "VALUATION",
      api_params: { VALUATION: { query: effectiveQueryText } },
    };
  }
  if (criterion === "fundamentals") {
    return {
      ...common,
      required_data: ["PERFORMANCE"],
      primary_focus: "PERFORMANCE",
      api_params: { PERFORMANCE: { tickers, query: effectiveQueryText } },
    };
  }
  return {
    ...common,
    required_data: ["NEWS"],
    primary_focus: "NEWS",
    api_params: { NEWS: { query: `${tickers.join(" ")} latest news catalysts and risks`, language } },
  };
}

export function answerMomentumChoice(
  view: ListView,
  candidates: ListItem[],
  language: "en" | "zh",
): { answer: string; ticker: string | null; claim: string; derivation: ListExtremeDerivation | null } {
  const measured = candidates
    .map((item, index) => ({ item, index, value: item.metrics.changePercent }))
    .filter((entry): entry is { item: ListItem; index: number; value: number } =>
      typeof entry.value === "number" && Number.isFinite(entry.value),
    )
    .sort((a, b) => b.value - a.value || a.index - b.index);
  if (measured.length !== candidates.length || measured.length === 0) {
    const answer = language === "zh"
      ? "当前榜单没有覆盖这些候选的完整涨跌幅数据，无法可靠按短期动量比较。"
      : "The current list does not contain complete price-change data for these candidates, so I cannot rank them reliably by momentum.";
    return { answer, ticker: null, claim: answer, derivation: null };
  }
  const winner = measured[0];
  const ticker = winner.item.ticker;
  const name = winner.item.name || ticker || "the first candidate";
  const pct = `${winner.value >= 0 ? "+" : ""}${winner.value.toFixed(2)}%`;
  const answer = language === "zh"
    ? `仅按当前 ${view.label || view.id} 的短期动量，${name}${ticker && name !== ticker ? `（${ticker}）` : ""}最强，涨跌幅为 ${pct}。这只是动量排名，不是完整的买入建议。`
    : `On short-term momentum alone within ${view.label || view.id}, ${name}${ticker && name !== ticker ? ` (${ticker})` : ""} ranks highest at ${pct}. This is a momentum ranking, not a complete buy recommendation.`;
  // Derivation built HERE — at the single source of truth for how momentum ranks
  // (changePercent argmax over the candidates) — so JUSTIFY can't drift from this definition.
  const derivation: ListExtremeDerivation | null = ticker
    ? {
        kind: "list_extreme",
        viewId: view.id,
        field: "changePercent",
        direction: "max",
        winnerTicker: ticker,
        candidateTickers: candidates.map((c) => c.ticker).filter((t): t is string => !!t),
      }
    : null;
  return { answer, ticker, claim: answer, derivation };
}
