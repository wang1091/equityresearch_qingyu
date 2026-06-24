/**
 * Validation layer for the untrusted upstream Stock Picker (LLM) response.
 *
 * The backend MUST funnel every raw upstream response through `parseStockPickerResponse`
 * before trusting it. Two distinct checks:
 *   1. parseStockPickerResponse — shape validation (zod). Malformed JSON / wrong
 *      types → null, so the caller can fall back instead of rendering garbage.
 *   2. hasRenderableContent — semantic check. A schema-valid but empty response
 *      (no answer, no scores, no list) is useless; this catches it.
 *
 * Kept pure (no logger import) so it is usable from both server and client; the
 * caller decides how to log/fall back.
 */
import { stockPickerResponseSchema, type StockPickerResponse } from "./schema";

export type StockPickerParseResult =
  | { ok: true; value: StockPickerResponse }
  | { ok: false; error: string };

/** Shape-validate a raw upstream response. */
export function parseStockPickerResponse(raw: unknown): StockPickerParseResult {
  const result = stockPickerResponseSchema.safeParse(raw);
  if (!result.success) {
    return { ok: false, error: result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") };
  }
  return { ok: true, value: result.data };
}

/**
 * Does a (shape-valid) response actually carry something to render?
 *  - analysis: a textual answer or at least one engine score
 *  - trending / screened list: a non-empty category.stocks array
 */
export function hasRenderableContent(r: StockPickerResponse): boolean {
  const hasText = Boolean(r.detailedAnswer?.trim() || r.answer?.trim());
  const hasScore =
    [r.finalScore, r.sentimentScore, r.earningsScore, r.financialScore, r.valuationScore].some(
      (s) => typeof s === "number",
    );
  const hasList = Array.isArray(r.category?.stocks) && r.category!.stocks!.length > 0;
  return hasText || hasScore || hasList;
}
