// List-turn → classifier-history projection. Compacts a list-shaped direct-card
// result (TRENDING / MARKET_DATA / STOCK_PICKER) into ONE line carrying just the
// identity + the list's defining axis, so a follow-up like "这些里哪只…/of these"
// can resolve the SET from the 400-char classifier history (formatHistoryAsText,
// llm/history.ts) instead of an HTML card whose first 400 chars are markup.
//
// All three list projectors (TRENDING / MARKET_DATA / STOCK_PICKER) + their shared
// helpers now live in shared/listProjection.ts so the migrated source_card cards and
// the html_card fallback path emit the SAME classifier line. This dispatcher remains
// for the html_card branch's fallback. See docs/CARD_RENDER_MIGRATION_PLAN.md.
import { projectTrending, projectMarketData, projectStockPicker } from "@shared/listProjection";

/**
 * Project a list-shaped direct-card payload to one classifier-history line.
 * Returns null when `source` isn't a projectable list source, the payload failed,
 * or the list is empty — caller then falls back to its existing content.
 */
export function projectListTurnToHistory(source: string, payload: any): string | null {
  if (!payload || payload.error) return null;
  switch (source) {
    case "TRENDING":
      return projectTrending(payload);
    case "MARKET_DATA":
      return projectMarketData(payload);
    case "STOCK_PICKER":
      return projectStockPicker(payload);
    default:
      return null;
  }
}
