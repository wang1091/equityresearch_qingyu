/**
 * Express routes for the FDA proxy: /fda/companies/:ticker and /fda/companies
 * (with optional ?company= search). Registered on the API router by routes.ts
 * (mirrors registerStockPickerRoutes / etc.). Thin pass-through to the FDA
 * upstream service.
 *
 * Extracted verbatim from routes.ts (per-domain split) — no behavior change.
 * Behavior pinned by L1 (route table) and L2 (routes/fda.test.ts).
 */
import type { Router } from "express";
import { logger, getErrorMessage } from "../utils";
import { fetchFdaUpstream } from "../fda/service";

export function registerFdaRoutes(apiRouter: Router): void {
  // api/fda-proxy endpoint
  apiRouter.get("/fda/companies/:ticker", async (req, res) => {
    try {
      const { ticker } = req.params;
      const data = await fetchFdaUpstream(`/api/companies/${ticker}`);
      res.json(data);
    } catch (error) {
      logger.error("FDA proxy error:", error);
      const errorMessage = getErrorMessage(error);
      res.status(500).json({ error: errorMessage });
    }
  });

  apiRouter.get("/fda/companies", async (req, res) => {
    try {
      const { company } = req.query;
      const path =
        company && typeof company === "string"
          ? `/api/companies/search?company=${encodeURIComponent(company)}`
          : `/api/companies`;
      const data = await fetchFdaUpstream(path);
      res.json(data);
    } catch (error) {
      logger.error("FDA proxy error:", error);
      const errorMessage = getErrorMessage(error);
      res.status(500).json({ error: errorMessage });
    }
  });
}
