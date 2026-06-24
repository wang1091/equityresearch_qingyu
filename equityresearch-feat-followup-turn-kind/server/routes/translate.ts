/**
 * Express route for on-demand UI translation: /translate-visible-content
 * (translates a string or object payload to en/zh). Registered on the API router
 * by routes.ts (mirrors registerStockPickerRoutes / etc.).
 *
 * Extracted verbatim from routes.ts (per-domain split) — no behavior change.
 * Behavior pinned by L1 (route table + 400 contract) and L2
 * (routes/translate.test.ts).
 */
import type { Router } from "express";
import { logger, successResponse, errorResponse } from "../utils";
import { translateTextToLanguage, translateJsonValuesToLanguage } from "../translation";

export function registerTranslateRoutes(apiRouter: Router): void {
  apiRouter.post("/translate-visible-content", async (req, res) => {
    try {
      const { targetLanguage, mode = "plain", payload } = req.body;

      if (targetLanguage !== "en" && targetLanguage !== "zh") {
        return res.status(400).json(errorResponse("targetLanguage must be 'en' or 'zh'"));
      }

      if (typeof payload === "string") {
        const translated = await translateTextToLanguage(
          payload,
          targetLanguage,
          mode === "html" ? "html" : mode === "markdown" ? "markdown" : "plain",
        );
        return res.json(successResponse({ translated }));
      }

      if (payload && typeof payload === "object") {
        const translated =
          await translateJsonValuesToLanguage(payload, "visible frontend content", targetLanguage);
        return res.json(successResponse({ translated: translated || payload }));
      }

      return res.json(successResponse({ translated: payload }));
    } catch (error) {
      logger.error("❌ Visible content translation failed:", error);
      return res.status(500).json(
        errorResponse(
          error instanceof Error ? error.message : "Failed to translate visible content",
        ),
      );
    }
  });
}
