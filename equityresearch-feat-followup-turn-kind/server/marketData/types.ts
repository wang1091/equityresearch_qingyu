// server/marketData/types.ts
//
// Contract moved to shared/marketData (single source of truth). Re-exported here
// so existing `from "./types"` / `from "../marketData/types"` imports keep working.
export type {
  MarketDataQueryType,
  MarketDataRequest,
  QuoteData,
  HistoricalPoint,
  CalculatedMetrics,
  MarketDataResult,
  MarketDataFailure,
  MarketDataResponse,
} from "../../shared/marketData";
