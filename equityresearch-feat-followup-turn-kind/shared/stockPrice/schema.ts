/**
 * Wire contract for the STOCK_PRICE response (server/quotes/service.ts —
 * getStockPrice, Yahoo chart + FMP profile). Single source of truth so the card
 * formatter and simplifier read the same shape.
 *
 * NOTE the historical series field is `chartData` with `{t,c,v}` (epoch-ms /
 * close / volume) — NOT `historicalData`/`{date,close,volume}`. simplifyStockPrice
 * read the latter (which doesn't exist), so its recentStats/recentSamples were
 * always empty; this type pins the real shape.
 */

export interface StockPriceQuote {
  price: number | null;
  change: number | null;
  changePercent: number | null;
  previousClose: number | null;
}

export interface StockPriceRange {
  high: number | null;
  low: number | null;
}

/** Intraday/daily chart point: t = epoch ms, c = close, v = volume. */
export interface StockPriceChartPoint {
  t: number;
  c: number;
  v: number;
}

export interface StockPriceResponse {
  success: boolean;
  ticker: string;
  currency: string | null;
  exchangeName: string | null;
  currentPrice: StockPriceQuote;
  dayRange: StockPriceRange;
  fiftyTwoWeekRange: StockPriceRange;
  marketState: string | null;
  volume: number | null;
  marketCap: number | null;
  timestamp: string;
  chartData: StockPriceChartPoint[];
}
