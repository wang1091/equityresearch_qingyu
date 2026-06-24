/**
 * Express routes for the Rumor Check proxy: /rumor-check/chatbot and its
 * backward-compat alias /detect-rumor. Registered on the API router by routes.ts
 * (mirrors registerStockPickerRoutes / registerPerformanceRoutes /
 * registerEarningsRoutes). Proxies to the internal rumor chatbot with a legacy
 * detect-rumor fallback.
 *
 * Extracted verbatim from routes.ts (per-domain split) — no behavior change.
 * Behavior pinned by L1 (routes.smoke.test.ts route table) and L2
 * (routes/rumor.test.ts). The rumor env getters (incl. getApiBaseUrl, used only
 * by getRumorLegacyFallbackUrl) move here with the domain.
 */
import type { Router } from "express";
import { logger } from "../utils";
import { proxyRumorChatbot } from "../rumor/service";

export function registerRumorRoutes(apiRouter: Router): void {
  apiRouter.post("/rumor-check/chatbot", async (req, res) => {
    logger.info("🔍 /api/rumor-check/chatbot called");
    try {
      const data = await proxyRumorChatbot(req.body);
      res.json(data);
    } catch (error) {
      logger.error("❌ Rumor chatbot proxy error:", error);
      res
        .status(500)
        .json({ success: false, error: "Rumor check service unavailable" });
    }
  });

  // Backward-compatible alias during migration.
  apiRouter.post("/detect-rumor", async (req, res) => {
    logger.info("🔍 /api/detect-rumor called");
    try {
      const data = await proxyRumorChatbot(req.body);
      res.json(data);
    } catch (error) {
      logger.error("❌ Rumor detect error:", error);
      res
        .status(500)
        .json({ success: false, error: "Rumor check service unavailable" });
    }
  });
}
