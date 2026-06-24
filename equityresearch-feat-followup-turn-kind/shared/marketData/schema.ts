/**
 * Wire contract for the MARKET_DATA service. Single source of truth — moved here
 * from server/marketData/types.ts (which now re-exports these) so server + client
 * share one definition. Mirrors server/marketData/marketDataService.ts output.
 */

export type MarketDataQueryType =
  | "price"
  | "historical"
  | "market_cap"
  | "key_metrics"
  | "return_calc"
  | "portfolio"
  | "comparison"
  | "general";

export interface MarketDataRequest {
  tickers: string[];
  queryType: MarketDataQueryType;
  /** ISO date string for historical start */
  fromDate?: string;
  /** ISO date string for historical end */
  toDate?: string;
  /** Raw user question for programmatic calculation context */
  question: string;
  lang?: "en" | "zh";
}

export interface QuoteData {
  ticker: string;
  price: number;
  change: number;
  changePercent: number;
  previousClose: number;
  open: number;
  dayHigh: number;
  dayLow: number;
  volume: number;
  marketCap: number | null;
  sharesOutstanding: number | null;
  pe: number | null;
  ps: number | null;
  evEbitda: number | null;
  eps: number | null;
  dividendYield: number | null;
  beta: number | null;
  fiftyTwoWeekHigh: number | null;
  fiftyTwoWeekLow: number | null;
  ytdReturn: number | null;
  companyName: string;
  sector: string | null;
  currency: string;
  exchange: string;
  provider: "fmp" | "yahoo";
}

export interface HistoricalPoint {
  date: string;
  close: number;
  volume: number;
}

export interface CalculatedMetrics {
  ytdReturnPct?: string;
  totalReturnPct?: string;
  hypotheticalValue?: string;
  hypotheticalInvested?: string;
  dividendYieldPct?: string;
  marketCapFmt?: string;
  peRatio?: string;
  psRatio?: string;
  evEbitdaFmt?: string;
}

export interface MarketDataResult {
  success: true;
  tickers: string[];
  queryType: MarketDataQueryType;
  quotes: QuoteData[];
  historical?: Record<string, HistoricalPoint[]>;
  calculated?: CalculatedMetrics;
  provider: "fmp" | "yahoo" | "mixed";
  fetchedAt: string;
}

export interface MarketDataFailure {
  success: false;
  error: "MARKET_DATA_UNAVAILABLE";
  reason: string;
  tickers: string[];
}

export type MarketDataResponse = MarketDataResult | MarketDataFailure;
