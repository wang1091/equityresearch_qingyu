/**
 * Express route for red-flag analysis: /analyze-redflags. Registered on the API
 * router by routes.ts (mirrors registerStockPickerRoutes / etc.). Calls DeepSeek
 * to score news for risks; degrades gracefully (always HTTP 200) when the key is
 * missing or the upstream fails.
 *
 * Extracted verbatim from routes.ts (per-domain split) — no behavior change.
 * Behavior pinned by L1 (route table + 400 contract) and L2
 * (routes/redflags.test.ts).
 */
import type { Router } from "express";
import { logger, cleanJsonResponse } from "../utils";
import { getDeepSeekKey } from "./_shared";
import { callChatWithFailover, resolveChatChain } from "../llm/chat";
import { REDFLAGS_SYSTEM_PROMPT, buildRedflagsUserMessage } from "./redflagsPrompts";

export function registerRedflagsRoutes(apiRouter: Router): void {
  apiRouter.post("/analyze-redflags", async (req, res) => {
    console.log("🚩 /api/analyze-redflags called");

    try {
      const { ticker, newsContent } = req.body;

      if (!ticker || !newsContent) {
        return res.status(400).json({
          success: false,
          error: "Ticker and newsContent are required",
        });
      }

      // ✅ 改用DeepSeek
      const deepSeekKey = getDeepSeekKey();
      if (!deepSeekKey) {
        return res.json({
          success: true,
          redflag_count: 0,
          severity: "unknown",
          summary: "DeepSeek API not configured",
        });
      }

      console.log(`🔍 Analyzing red flags for ${ticker} using DeepSeek`);

      const { response } = await callChatWithFailover(resolveChatChain(), {
        temperature: 0.1,
        max_tokens: 250,
        messages: [
          { role: "system", content: REDFLAGS_SYSTEM_PROMPT },
          { role: "user", content: buildRedflagsUserMessage(ticker, newsContent) },
        ],
      });
      const content = response.choices?.[0]?.message?.content || "{}";

      console.log("🤖 DeepSeek response:", content);

      // 清理可能的markdown包裹
      const cleanContent = cleanJsonResponse(content);
      const result = JSON.parse(cleanContent);

      logger.success(`Found ${result.redflag_count || 0} red flags for ${ticker}`);

      res.json({
        success: true,
        ticker,
        redflag_count: result.redflag_count || 0,
        severity: result.severity || "low",
        summary: result.summary || "No red flags",
      });
    } catch (error) {
      logger.error("Red flag error:", error);
      res.json({
        success: true,
        redflag_count: 0,
        severity: "unknown",
        summary: "Analysis failed",
      });
    }
  });
}
