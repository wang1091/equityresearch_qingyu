/**
 * Express route for trending stocks: /trending-stocks (proxies the trending
 * upstream, with an optional ?category= variant). Registered on the API router
 * by routes.ts (mirrors registerStockPickerRoutes / etc.). The getTrendingApiUrl
 * getter moves here with the domain.
 *
 * Extracted verbatim from routes.ts (per-domain split) — no behavior change.
 * Behavior pinned by L1 (route table) and L2 (routes/trending.test.ts).
 */
import type { Router } from "express";
import { logger } from "../utils";
import { UpstreamFallbackError } from "../upstreamFetch";
import { fetchTrending } from "../trending/service";

export function registerTrendingRoutes(apiRouter: Router): void {
  // ========== Trending Stocks API ==========
  apiRouter.get("/trending-stocks", async (req, res) => {
    const lang = typeof req.query.lang === "string" ? req.query.lang : "en";
    const category = typeof req.query.category === "string" ? req.query.category : "";
    try {
      return res.json(await fetchTrending(lang, category));
    } catch (error) {
      logger.error("❌ /api/trending-stocks:", { error });
      // Preserve the upstream-status passthrough when one was carried; otherwise
      // (unreachable / total failure) surface 502 as before.
      const last = error instanceof UpstreamFallbackError ? error.errors[error.errors.length - 1] : undefined;
      if (last?.status) {
        return res.status(last.status).json({ success: false, error: `Trending upstream ${last.status}` });
      }
      return res.status(502).json({ success: false, error: "Trending stocks unavailable" });
    }
  });
}
