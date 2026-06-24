/**
 * Express routes for the internal market-data service: /market-data (FMP →
 * Yahoo Finance via marketDataService). Registered on the API router by
 * routes.ts (mirrors registerStockPickerRoutes / etc.).
 *
 * The former /detect-market-data endpoint (regex query detector) was removed:
 * the agent hot path takes queryType/fromDate/toDate straight from the LLM
 * classifier's api_params (see apiCaller MARKET_DATA case), so the detector was
 * dead duplication of the classifier. See docs/LLM_TS_DUPLICATION_INVENTORY.md.
 */
import type { Router } from "express";
import { getMarketData } from "../marketData/marketDataService";

export function registerMarketDataRoutes(apiRouter: Router): void {
  // ========== Market Data API (FMP → Yahoo Finance) ==========
  // Additive endpoint — does not modify any existing route or fallback.
  apiRouter.post("/market-data", async (req, res) => {
    const { tickers, queryType, fromDate, toDate, question, lang } = req.body || {};
    if (!Array.isArray(tickers) || tickers.length === 0) {
      return res.status(400).json({ success: false, error: "tickers array required" });
    }
    const result = await getMarketData({
      tickers: tickers.map((t: string) => String(t).toUpperCase().trim()).filter(Boolean),
      queryType: queryType || "general",
      fromDate,
      toDate,
      question: typeof question === "string" ? question : "",
      lang: lang === "zh" ? "zh" : "en",
    });
    return res.json(result);
  });
}
