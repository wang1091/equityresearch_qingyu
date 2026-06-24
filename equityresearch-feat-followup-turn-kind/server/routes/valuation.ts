/**
 * Express route for the Valuation API: /valuation-analysis. Registered on the
 * API router by routes.ts (mirrors registerStockPickerRoutes /
 * registerPerformanceRoutes / registerEarningsRoutes / registerRumorRoutes).
 * Proxies the Python DCF service (/api/full-valuation) and maps the result into
 * the card payload.
 *
 * Extracted verbatim from routes.ts (per-domain split) — no behavior change.
 * Behavior pinned by L1 (route table + 400 contract) and L2
 * (routes/valuation.test.ts).
 */
import type { Router } from "express";
import { SERVER_CONFIG } from "../utils";

const getValuationApiUrl = () =>
  process.env.VALUATION_API_URL || "http://localhost:8503";

export function registerValuationRoutes(apiRouter: Router): void {
  apiRouter.post("/valuation-analysis", async (req, res) => {
    console.log("💰 /api/valuation-analysis called");

    try {
      const { ticker, query } = req.body;

      if (!ticker || typeof ticker !== "string") {
        return res.status(400).json({
          success: false,
          error: "Valid ticker symbol is required",
        });
      }

      console.log(`🔍 Valuation request for: ${ticker}`);

      // ========================================
      // 只使用 Python DCF 服务
      // ========================================

      console.log("📊 Calling Python DCF service...");

      const valuationUrl = getValuationApiUrl();
      const pythonResponse = await fetch(
        `${valuationUrl}/api/full-valuation`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ ticker }),
          signal: AbortSignal.timeout(SERVER_CONFIG.VALUATION_TIMEOUT),
        },
      );

      if (!pythonResponse.ok) {
        const errorData = await pythonResponse
          .json()
          .catch(() => ({ error: "Unknown error" }));

        console.warn(`⚠️ Python DCF failed: ${errorData.error}`);

        // 直接返回错误
        return res.json({
          success: false,
          ticker: ticker.toUpperCase(),
          error: "Valuation service unavailable",
          details:
            errorData.error || `Python DCF returned ${pythonResponse.status}`,
          data: null,
          response: `<div style="padding: 16px; background: #fff3cd; border-left: 4px solid #ffc107; border-radius: 8px;">
            <strong>💰 Valuation Analysis - ${ticker.toUpperCase()}</strong><br><br>
            <div style="color: #856404; font-weight: 600;">⚠️ Service Temporarily Unavailable</div>
            <div style="font-size: 0.9em; margin-top: 8px; color: #666;">
              Our DCF valuation service is currently unavailable. Please try:<br>
              • News Analysis for latest updates<br>
              • Performance Analysis for financial metrics<br>
              • Try again in a few minutes
            </div>
          </div>`,
        });
      }

      // Python DCF 成功
      const valuationData = await pythonResponse.json();
      console.log("✅ Python DCF successful");

      const upside = parseFloat(valuationData.upside_percentage);

      // 判断估值状态
      const valuationStatus =
        upside < -5
          ? "Overvalued"
          : upside > 5
            ? "Undervalued"
            : "Fairly Valued";
      const statusColor =
        upside < -5 ? "#ef4444" : upside > 5 ? "#10b981" : "#f59e0b";

      // 修改后的简洁格式
      // 修改后的版本 - 箭头居中，百分比完全居中
      const userResponse = `<strong>💰 Valuation Analysis for ${valuationData.ticker}</strong><br><br>
      <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 16px; border-radius: 12px; color: white; position: relative;">

        <!-- 主容器使用 flex 布局 -->
        <div style="display: flex; align-items: center; justify-content: space-between;">

          <!-- 左侧：价格信息 -->
          <div style="display: flex; align-items: center; gap: 16px;">
            <div>
              <div style="font-size: 11px; opacity: 0.8; margin-bottom: 4px;">Current Price</div>
              <div style="font-size: 26px; font-weight: bold;">$${valuationData.current_price.toFixed(2)}</div>
            </div>

            <!-- 箭头 - 垂直居中 -->
            <div style="font-size: 20px; opacity: 0.6; display: flex; align-items: center; height: 100%;">→</div>

            <div>
              <div style="font-size: 11px; opacity: 0.8; margin-bottom: 4px;">Target Price</div>
              <div style="font-size: 26px; font-weight: bold;">$${valuationData.target_price.toFixed(2)}</div>
            </div>
          </div>

          <!-- 右侧：涨跌幅信息 - 使用绝对定位居中 -->
          <div style="position: absolute; left: 50%; transform: translateX(-50%);
                      background: ${statusColor}; padding: 10px 20px; border-radius: 10px; text-align: center;">
            <div style="font-size: 22px; font-weight: bold; line-height: 1;">
              ${upside > 0 ? "+" : ""}${upside.toFixed(1)}%
            </div>
            <div style="font-size: 11px; margin-top: 3px; font-weight: 500; text-transform: uppercase;">
              ${valuationStatus}
            </div>
          </div>

          <!-- 占位元素，保持布局平衡 -->
          <div style="width: 140px;"></div>
        </div>

        <!-- 底部信息栏 -->
        <div style="display: flex; gap: 20px; margin-top: 14px; padding-top: 12px; border-top: 1px solid rgba(255,255,255,0.2); font-size: 12px; opacity: 0.9;">
          <span><strong>Confidence:</strong> ${(valuationData.confidence * 100).toFixed(0)}%</span>
          <span><strong>Method:</strong> ${valuationData.method}</span>
        </div>

        ${
          valuationData.rationale
            ? `
        <div style="background: rgba(255,255,255,0.1); padding: 10px; border-radius: 8px; font-size: 12px; line-height: 1.5; margin-top: 10px;">
          ${valuationData.rationale}
        </div>`
            : ""
        }
      </div>`;

      // 修改这部分返回
      res.json({
        success: true,
        ticker: valuationData.ticker,
        current_price: valuationData.current_price,

        // ✅ 新增：返回完整的估值数据
        valuations: valuationData.details
          ? {
              dcf: valuationData.details.dcf_valuation,
              relative: valuationData.details.relative_valuation,
            }
          : null,

        // AI recommendation — use verdict (Overvalued/Fairly Valued/Undervalued)
        ai_recommendation: {
          chosen_method: valuationData.method,
          chosen_price: valuationData.target_price,
          upside_percentage: valuationData.upside_percentage,
          verdict: valuationData.verdict || valuationStatus,
          confidence: valuationData.confidence,
          rationale: valuationData.rationale,
        },

        // 保留原始的 response 用于向后兼容
        response: userResponse,

        // 保留原有字段
        data: {
          current_price: valuationData.current_price,
          target_price: valuationData.target_price,
          upside_percentage: valuationData.upside_percentage,
          verdict: valuationData.verdict || valuationStatus,
          confidence: valuationData.confidence,
          method: valuationData.method,
        },
        details: valuationData.details || null,
        ai_fallback_used: false,
      });
    } catch (error) {
      console.error("❌ Valuation error:", error);

      res.json({
        success: false,
        ticker: req.body.ticker || "Unknown",
        error: "Analysis failed",
        details: error instanceof Error ? error.message : "Unknown error",
        data: null,
        response: `<div style="padding: 16px; background: #ffebee; border-left: 4px solid #ef5350; border-radius: 8px;">
          <strong>💰 Valuation Analysis</strong><br><br>
          <div style="color: #c62828; font-weight: 600;">❌ Analysis Unavailable</div>
          <div style="font-size: 0.9em; margin-top: 8px; color: #666;">
            Unable to complete valuation. Try News Analysis or Performance Analysis.
          </div>
        </div>`,
      });
    }
  });
}
