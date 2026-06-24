/**
 * Broad market “which stocks are cheap/expensive” questions.
 * Stock Picker upstream treats bare `query` as a company name → 500; these need a Yahoo list `category`.
 */

export type StockPickerListCategory =
  | "most_discussed"
  | "most_active"
  | "top_gainers"
  | "top_losers"
  | "top_listeners";

/** Broad “which stocks are cheap/expensive” scans → Stock Picker category lists (not single-ticker analysis). */
export function looksLikeMarketValuationScreenQuery(rawQuery: string): boolean {
  const query = rawQuery.trim();
  if (!query) return false;
  const lower = query.toLowerCase();

  if (
    /哪些.*股票.*(低估|高估|便宜|价值股)|^(寻找|推荐|列出).*(低估|高估|便宜股|价值股)/.test(
      query,
    )
  ) {
    return true;
  }

  const hasScreenTargets =
    /\b(stocks?|shares?|tickers?|companies|names)\b/i.test(query);
  const hasValuationLens =
    /\b(undervalued|overvalued|underpriced|overpriced)\b/.test(lower) ||
    /\b(cheap|expensive)\b[\s\S]{0,12}\b(stocks?|shares?)\b/i.test(lower) ||
    /\b(stocks?|shares?)\b[\s\S]{0,12}\b(cheap|expensive)\b/i.test(lower) ||
    /\b(value\s+stocks?|growth\s+at\s+a\s+reasonable\s+price)\b/i.test(lower);
  const isListOrCompareCue =
    /\b(which|what|whose|show|list|find|give|suggest|recommend|name|any)\b/i.test(
      lower,
    );

  if (hasValuationLens && hasScreenTargets && isListOrCompareCue) {
    return true;
  }

  if (
    /\b(find|show|list|give|suggest|recommend|name)\b[\s\S]{0,56}\b(undervalued|overvalued|underpriced|overpriced)\b/i.test(
      lower,
    )
  ) {
    return true;
  }

  if (
    /\b(which|what)\b[\s\S]{0,72}\b(undervalued|overvalued|underpriced|overpriced)\b/i.test(
      lower,
    ) &&
    hasScreenTargets
  ) {
    return true;
  }

  if (
    /\b(best|top)\b[\s\S]{0,48}\b(undervalued|value|cheap)\b[\s\S]{0,32}\b(stocks?|shares?|picks?)\b/i.test(
      lower,
    )
  ) {
    return true;
  }

  return false;
}

export function pickValuationScreenStockPickerCategory(
  rawQuery: string,
): StockPickerListCategory {
  const q = rawQuery.trim();
  const lower = q.toLowerCase();

  if (/高估|泡沫|过热|太贵/.test(q)) {
    return "top_gainers";
  }
  if (/低估|便宜股|价值股|超跌|捡漏/.test(q)) {
    return "top_losers";
  }
  if (/\b(overvalued|overpriced|expensive|frothy|bubble)\b/.test(lower)) {
    return "top_gainers";
  }
  if (
    /\b(undervalued|underpriced|cheap|bargain)\b/.test(lower) ||
    /\bvalue\s+stocks?\b/.test(lower)
  ) {
    return "top_losers";
  }
  return "most_discussed";
}
