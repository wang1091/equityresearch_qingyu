/**
 * MarketData shared module — wire contract for the MARKET_DATA service. Single
 * source of truth (mirrors server/marketData/marketDataService.ts).
 */
export {
  type MarketDataQueryType,
  type MarketDataRequest,
  type QuoteData,
  type HistoricalPoint,
  type CalculatedMetrics,
  type MarketDataResult,
  type MarketDataFailure,
  type MarketDataResponse,
} from "./schema";
