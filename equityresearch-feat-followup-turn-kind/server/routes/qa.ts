/**
 * Express route for general Q&A: /general-qa. Registered on the API router by
 * routes.ts (mirrors registerStockPickerRoutes / etc.). Proxies a free-form
 * question to Perplexity (sonar, online search) and returns a lightly
 * HTML-formatted answer with citations.
 *
 * Extracted verbatim from routes.ts (per-domain split) — no behavior change.
 * Behavior pinned by L1 (route table + 400 contract) and L2 (routes/qa.test.ts).
 */
import type { Router } from "express";
import { getPerplexityKey } from "./_shared";
import { SERVER_CONFIG } from "../utils";
import { callChatWithFailover, perplexityChatProvider } from "../llm/chat";

export function registerQaRoutes(apiRouter: Router): void {
  apiRouter.post("/general-qa", async (req, res) => {
    console.log("💬 /api/general-qa called");

    try {
      const { query } = req.body;

      if (!query || typeof query !== "string") {
        return res.status(400).json({
          success: false,
          error: "Valid query is required",
        });
      }

      console.log(`🤖 Processing general question: "${query}"`);

      const perplexityKey = getPerplexityKey();
      if (!perplexityKey) {
        return res.status(503).json({
          success: false,
          error: "Perplexity API not configured",
        });
      }

      // Routes through the shared LLM layer: per-attempt timeout + unified
      // cancellation, and ready to fail over if more providers are added. The
      // Perplexity provider surfaces its top-level `citations` on the response.
      const { response: data } = await callChatWithFailover(
        [perplexityChatProvider(perplexityKey, "sonar")], // sonar = 带在线搜索
        {
          messages: [{ role: "user", content: query }],
          temperature: 0.2,
          max_tokens: 800,
        },
        { timeoutMs: SERVER_CONFIG.PERPLEXITY_TIMEOUT },
      );

      const answer = data.choices?.[0]?.message?.content;

      if (!answer) {
        throw new Error("Empty response from Perplexity");
      }

      console.log("✅ General Q&A completed");

      // Markdown转HTML
      const formattedAnswer = answer
        .replace(/\[\d+\]/g, "") // 加这行，去掉 [1] [2] 等
        .replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>")
        .replace(/\n/g, "<br>");

      res.json({
        success: true,
        query,
        answer: `<strong>💡 Answer</strong><br><br>${formattedAnswer}`,
        citations: data.citations || [],
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      console.error("❌ General Q&A error:", error);
      res.status(500).json({
        success: false,
        error: "Failed to process question",
        details: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });
}
