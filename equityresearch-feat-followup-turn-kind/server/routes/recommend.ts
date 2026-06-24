/**
 * Express route for stock recommendations: /recommend-stocks. Registered on the
 * API router by routes.ts (mirrors registerStockPickerRoutes /
 * registerPerformanceRoutes / etc.). Calls Perplexity (sonar-pro) and parses a
 * JSON array of picks, with a manual-parsing fallback.
 *
 * Extracted verbatim from routes.ts (per-domain split) — no behavior change.
 * parseRecommendationsManually (the manual fallback) comes with it — it was a
 * closure helper that previously sat between earnings handlers in routes.ts.
 * Behavior pinned by L1 (route table + 400 contract) and L2
 * (routes/recommend.test.ts).
 */
import type { Router } from "express";
import { logger, cleanJsonResponse, SERVER_CONFIG } from "../utils";
import { getPerplexityKey } from "./_shared";
import { callChatWithFailover, perplexityChatProvider } from "../llm/chat";

export function registerRecommendRoutes(apiRouter: Router): void {
  // ✅ 改进的手动解析函数 (保持不变)
  function parseRecommendationsManually(text: string): any[] {
    console.log("🔧 Starting manual parsing...");

    const recommendations: any[] = [];
    const lines = text.split("\n").filter((line) => line.trim());

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      // 匹配包含股票代码的行
      const tickerMatch = line.match(/\b([A-Z]{2,5})\b/);

      if (tickerMatch) {
        const symbol = tickerMatch[1];

        // 尝试提取公司名称
        let name = symbol;
        const namePatterns = [
          /\(([^)]+)\)/, // (Company Name)
          /[A-Z]{2,5}\s*[-:]\s*([^,\n]+)/, // AAPL - Company Name
          /[A-Z]{2,5}\s+([A-Z][a-zA-Z\s&.]+?)(?:\s*[-:]|$)/, // AAPL Company Name Inc.
        ];

        for (const pattern of namePatterns) {
          const match = line.match(pattern);
          if (match && match[1]) {
            name = match[1].trim();
            break;
          }
        }

        // 尝试获取理由（当前行或下一行）
        let rationale = "";
        const rationaleMatch = line.match(/[:|\-]\s*(.+)$/);
        if (rationaleMatch) {
          rationale = rationaleMatch[1].trim();
        } else if (i + 1 < lines.length) {
          rationale = lines[i + 1].trim();
        }

        // 如果理由太短，尝试获取更多内容
        if (rationale.length < 20 && i + 2 < lines.length) {
          rationale += " " + lines[i + 2].trim();
        }

        if (!rationale) {
          rationale = "Strong fundamentals and growth potential.";
        }

        recommendations.push({
          symbol,
          name,
          rationale: rationale.substring(0, 200), // 限制长度
        });

        // 找到 3 个就停止
        if (recommendations.length >= 3) {
          break;
        }
      }
    }

    console.log(
      `🔧 Manual parsing found ${recommendations.length} recommendations`,
    );
    return recommendations;
  }
  apiRouter.post("/recommend-stocks", async (req, res) => {
    console.log("🤖 /api/recommend-stocks called");

    try {
      const { industry } = req.body;

      if (!industry || typeof industry !== "string") {
        return res.status(400).json({
          success: false,
          error: "Valid industry is required",
        });
      }

      console.log(`📊 Requesting stock recommendations for: ${industry}`);

      const perplexityKey = getPerplexityKey();
      if (!perplexityKey) {
        console.error("❌ PERPLEXITY_API_KEY not configured");
        return res.status(503).json({
          success: false,
          error: "Perplexity API not configured",
        });
      }

      // ✅ 改进的提示词 - 要求更清晰的 JSON 格式
      const prompt = `Recommend 3 stocks in ${industry} sector for 2025.

      Return ONLY a JSON array, nothing else. No markdown, no explanation.
      Keep rationale under 50 words, no quotes or special characters inside.

      Example format:
      [
        {"symbol": "AAPL", "name": "Apple Inc", "rationale": "Strong revenue growth and services expansion"},
        {"symbol": "MSFT", "name": "Microsoft", "rationale": "Cloud dominance and AI integration"},
        {"symbol": "GOOGL", "name": "Alphabet", "rationale": "Search monopoly and emerging AI"}
      ]`;

      console.log("🤖 Calling Perplexity API with sonar-pro...");

      // Routes through the shared LLM layer: per-attempt timeout + unified
      // cancellation, ready to fail over if more providers are added. Perplexity
      // search params (recency/related) ride on the ChatRequest unchanged.
      const { response: data } = await callChatWithFailover(
        [perplexityChatProvider(perplexityKey, "sonar-pro")],
        {
          messages: [
            {
              role: "system",
              content:
                "You are a financial analyst. Return JSON data as requested, followed by any additional text.",
            },
            { role: "user", content: prompt },
          ],
          max_tokens: 1500,
          temperature: 0.1,
          search_recency_filter: "month",
          return_related_questions: false,
        },
        { timeoutMs: SERVER_CONFIG.PERPLEXITY_TIMEOUT },
      );

      const aiResponse = data.choices?.[0]?.message?.content || "";

      // ✅ 打印完整响应以便调试
      console.log("🤖 Full AI Response:");
      console.log("==================");
      console.log(aiResponse);
      console.log("==================");

      let recommendations: any[] = [];
      let summary = "";

      try {
        // ✅ 更健壮的 JSON 提取
        // 1. 先尝试移除 markdown 代码块
        let cleanedResponse = cleanJsonResponse(aiResponse);

        // 2. 提取 JSON 数组
        const jsonMatch = cleanedResponse.match(/\[[\s\S]*\]/);

        if (jsonMatch) {
          const jsonStr = jsonMatch[0];
          logger.debug("Extracted JSON string:", jsonStr);
          console.log(jsonStr);

          try {
            recommendations = JSON.parse(jsonStr);
            console.log(`✅ Parsed ${recommendations.length} recommendations`);

            // ✅ 验证每个推荐的结构
            recommendations = recommendations.map((rec, index) => {
              if (!rec.symbol || !rec.name || !rec.rationale) {
                console.warn(`⚠️ Incomplete recommendation ${index + 1}:`, rec);
              }

              return {
                symbol: (rec.symbol || "N/A").trim(),
                name: (rec.name || "Unknown Company").trim(),
                rationale: (
                  rec.rationale || "Strong fundamentals and growth potential."
                ).trim(),
              };
            });
          } catch (jsonError) {
            console.error("❌ JSON parse error:", jsonError);
            console.log("Attempting manual parsing...");
            recommendations = parseRecommendationsManually(aiResponse);
          }

          // 提取总结（JSON 后面的文本）
          const afterJson = aiResponse
            .substring(jsonMatch.index! + jsonMatch[0].length)
            .trim();
          summary =
            afterJson
              .replace(/```/g, "")
              .replace(/^[\s\n\-:"\}\]]+/, "")
              .trim()
              .split("\n")[0] || "Market analysis complete.";
          ("Market analysis complete.");
        } else {
          console.warn("⚠️ No JSON array found in response");
          recommendations = parseRecommendationsManually(aiResponse);
          summary = "Stock recommendations based on market analysis.";
        }
      } catch (parseError) {
        console.error("❌ Parsing error:", parseError);
        recommendations = parseRecommendationsManually(aiResponse);
        summary = "Stock recommendations based on market analysis.";
      }

      // ✅ 最终验证
      if (!recommendations || recommendations.length === 0) {
        throw new Error("No valid recommendations generated");
      }

      // 确保只有 3 个推荐
      recommendations = recommendations.slice(0, 3);

      console.log("✅ Final recommendations:");
      recommendations.forEach((rec, i) => {
        console.log(`  ${i + 1}. ${rec.symbol} - ${rec.name}`);
        console.log(`     ${rec.rationale.substring(0, 80)}...`);
      });

      res.json({
        success: true,
        industry,
        recommendations,
        summary,
        timestamp: new Date().toISOString(),
        source: "Perplexity AI (sonar-pro)",
      });
    } catch (error) {
      console.error("❌ Recommendation error:", error);

      res.status(500).json({
        success: false,
        error: "Failed to generate recommendations",
        details: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });

}
