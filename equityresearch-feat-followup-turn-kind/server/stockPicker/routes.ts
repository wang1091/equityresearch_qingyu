/**
 * Express routes for the Stock Picker proxy. Registered on the API router by
 * routes.ts (mirrors registerChatHistoryRoutes). Proxies the browser's direct
 * /api/stock-picker/query calls to the upstream scoring service; the agent
 * pipeline uses stockPicker/service.ts instead.
 */
import type { Router } from "express";
import { logger } from "../utils";
import { getStockPickerApiBase } from "../upstreamConfig";
import {
  looksLikeMarketValuationScreenQuery,
  pickValuationScreenStockPickerCategory,
} from "../../shared/stockPicker";

export function registerStockPickerRoutes(apiRouter: Router): void {
  apiRouter.post("/stock-picker/query", async (req, res) => {
    logger.info("💼 /api/stock-picker/query called");

    const { category, ticker, company, query, lang } = req.body || {};
    const hasValidInput = [category, ticker, company, query].some(
      (value) => typeof value === "string" && value.trim().length > 0,
    );

    if (!hasValidInput) {
      return res.status(400).json({
        error: "category, ticker, company, or query is required",
      });
    }

    const qStr = typeof query === "string" ? query.trim() : "";
    const hasTickerOrCompany =
      (typeof ticker === "string" && ticker.trim().length > 0) ||
      (typeof company === "string" && company.trim().length > 0);
    const hasCategory =
      typeof category === "string" && category.trim().length > 0;

    let effectiveCategory =
      typeof category === "string" && category.trim() ? category.trim() : "";

    if (qStr && !hasCategory && !hasTickerOrCompany) {
      if (looksLikeMarketValuationScreenQuery(qStr)) {
        effectiveCategory = pickValuationScreenStockPickerCategory(qStr);
        logger.info(
          `💼 Stock Picker: injected category="${effectiveCategory}" for market valuation screen query`,
        );
      }
    }

    const payload = {
      ...(effectiveCategory ? { category: effectiveCategory } : {}),
      ...(typeof ticker === "string" && ticker.trim() ? { ticker: ticker.trim() } : {}),
      ...(typeof company === "string" && company.trim() ? { company: company.trim() } : {}),
      ...(qStr ? { query: qStr } : {}),
      ...(lang === "zh" || lang === "en" ? { lang } : {}),
    };

    try {
      const upstreamResponse = await fetch(`${getStockPickerApiBase()}/api/stock-picker/query`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(30000),
      });

      const responseText = await upstreamResponse.text();
      let data: unknown;
      try {
        data = responseText ? JSON.parse(responseText) : {};
      } catch {
        data = { answer: responseText };
      }

      if (!upstreamResponse.ok) {
        logger.error("❌ Stock Picker API error:", data);
        return res.status(upstreamResponse.status).json(data);
      }

      return res.json(data);
    } catch (error) {
      logger.error("❌ Stock Picker proxy error:", error);
      return res.status(502).json({
        error: error instanceof Error ? error.message : "Failed to query stock picker",
      });
    }
  });
}
