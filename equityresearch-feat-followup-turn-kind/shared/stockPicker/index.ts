/**
 * Stock Picker shared module — wire contract, upstream-response schema/validation,
 * and market-screen routing helpers. Imported by both server (apiCaller, agent)
 * and client (home.tsx) as the single source of truth for anything Stock Picker.
 */
export { stockPickerResponseSchema, type StockPickerResponse } from "./schema";
export {
  type StockPickerCardPayload,
  type StockPickerRenderMode,
} from "./wire";
export {
  parseStockPickerResponse,
  hasRenderableContent,
  type StockPickerParseResult,
} from "./validate";
export {
  looksLikeMarketValuationScreenQuery,
  pickValuationScreenStockPickerCategory,
  type StockPickerListCategory,
} from "./marketScreen";
