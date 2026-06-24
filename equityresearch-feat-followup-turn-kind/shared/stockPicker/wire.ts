/**
 * Front/back wire contract for the `{type:"stock_picker"}` SSE payload.
 *
 *  - SINGLE intent (required_data === ["STOCK_PICKER"]): the backend fetches the
 *    score(s), validates them (see ./validate), and streams ONE of these. The
 *    frontend renders it with the legacy formatStockPicker* helpers — no second
 *    LLM pass, pixel-identical to the old card (same formatter code).
 *  - COMPOSITE intent ([STOCK_PICKER, NEWS, ...]): this payload is NOT used; the
 *    pipeline falls through to the generator, which synthesizes text only.
 *
 * This is our own envelope (constructed by the backend), so it does not need
 * runtime validation the way the upstream response does — only StockPickerResponse
 * crosses an untrusted LLM boundary.
 */
import type { StockPickerResponse } from "./schema";

/**
 * Which formatter the frontend applies:
 *  - "single"     → one analysis result → formatStockPickerAnswer
 *  - "comparison" → 2+ analysis results side by side → formatStockPickerComparison
 *  - "trending"   → a category/screened list → formatStockPickerTrending
 */
export type StockPickerRenderMode = "single" | "comparison" | "trending";

/** The `{type:"stock_picker"}` SSE payload (single-intent path only). */
export interface StockPickerCardPayload {
  mode: StockPickerRenderMode;
  language: "en" | "zh";
  /** Original user question — passed to formatStockPickerTrending for the heading. */
  query: string;
  /** 1 entry for single/trending, 2+ for comparison. Index-aligned with `labels`. */
  results: StockPickerResponse[];
  /** Display name per result (resolved company name, else ticker). Index-aligned with `results`. */
  labels: string[];
  /** Requested tickers whose per-ticker scoring call failed/validated-empty and were
   *  dropped from `results` (the fan-out is parallel + independent — a flaky upstream can
   *  return one ticker of a comparison but not the other). Lets the card tell the user a
   *  requested name couldn't be scored instead of silently showing a single-stock card.
   *  Omitted/empty when nothing dropped. */
  droppedTickers?: string[];
}
