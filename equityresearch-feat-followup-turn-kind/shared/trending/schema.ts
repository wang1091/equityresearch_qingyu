/**
 * Wire contract for the TRENDING response (server/trending/service.ts — the
 * stockpick trending backend). Single source of truth for formatter + simplifier.
 */

export interface TrendingStock {
  ticker: string;
  companyName?: string;
  price?: number;
  changePercent?: number;
  categoryRank?: number;
  marketTime?: string;
  dayLow?: number;
  dayHigh?: number;
  marketCap?: number;
  discussion_highlights?: string[];
  /** Other category ids this ticker also appears in. */
  duplicateCategories?: string[];
}

export interface TrendingCategory {
  id: string; // "most_discussed" | "most_active" | "top_gainers" | "top_losers"
  label: string;
  description?: string;
  stocks: TrendingStock[];
}

export interface TrendingResponse {
  success: boolean;
  date: string;
  fetchedAt?: string;
  categories: TrendingCategory[];
}
