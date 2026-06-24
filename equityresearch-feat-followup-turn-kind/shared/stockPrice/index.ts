/**
 * StockPrice shared module — wire contract for the STOCK_PRICE response
 * (mirrors server/quotes/service.ts getStockPrice).
 */
export {
  type StockPriceResponse,
  type StockPriceQuote,
  type StockPriceRange,
  type StockPriceChartPoint,
} from "./schema";
