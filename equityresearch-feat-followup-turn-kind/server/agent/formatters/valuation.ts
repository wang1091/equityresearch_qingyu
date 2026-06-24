// server/agent/formatters/valuation.ts
// Extracted verbatim from cardFormatter.ts (per-source split) — no behavior change.


export function formatValuationCard(data: any, language: string = "en"): string {
  const isZh = language === "zh";
  const ticker = data.ticker || "N/A";
  const currentPrice = data.current_price || 0;
  const targetPrice = data.target_price || 0;
  const method = data.method || "N/A";
  const confidence = (data.confidence || 0.7) * 100;
  const rationale = data.rationale || "";

  // Derive upside early so it can be used as last-resort verdict fallback
  const _upside = currentPrice > 0 && targetPrice > 0
    ? ((targetPrice - currentPrice) / currentPrice) * 100
    : 0;
  const _derivedVerdict = targetPrice > 0 && currentPrice > 0
    ? (_upside > 15 ? "Undervalued" : _upside < -15 ? "Overvalued" : "Fairly Valued")
    : "";

  // Read verdict — new field names only; fall back to upside-derived label.
  // Intentionally do NOT read data.recommendation / data.preliminary_recommendation:
  // those fields carry the old BUY/SELL/HOLD strings from an outdated API version.
  const recommendation =
    data.verdict ||
    data.preliminary_verdict ||
    _derivedVerdict;

  const dcf = data.details || {};
  const dcfPrice = dcf.dcf_price || dcf.dcf_valuation?.intrinsic_value || 0;
  const relHighPrice = dcf.rel_high_price || dcf.relative_valuation?.high_estimate || 0;
  const relLowPrice = dcf.rel_low_price || dcf.relative_valuation?.low_estimate || 0;
  const relMedianPrice = dcf.rel_median_price || dcf.relative_valuation?.median_estimate || 0;
  const peers = dcf.peers || dcf.relative_valuation?.peers || [];
  const reverseDcf = data.reverse_dcf || null;

  const dcfUpside = currentPrice > 0 ? ((dcfPrice - currentPrice) / currentPrice) * 100 : 0;
  const relativeUpside = currentPrice > 0 ? ((relMedianPrice - currentPrice) / currentPrice) * 100 : 0;
  const finalUpside = currentPrice > 0 ? ((targetPrice - currentPrice) / currentPrice) * 100 : 0;

  const upsideColor = (v: number) => v > 0 ? "#10b981" : "#ef4444";
  const upsideArrow = (v: number) => v > 0 ? "↑" : "↓";
  const upsideSign = (v: number) => v > 0 ? "+" : "";

  const recColor = recommendation.toLowerCase().includes("undervalued")
    ? { bg: "#dcfce7", text: "#166534", border: "#86efac" }
    : recommendation.toLowerCase().includes("overvalued")
    ? { bg: "#fee2e2", text: "#991b1b", border: "#fca5a5" }
    : { bg: "#fef3c7", text: "#92400e", border: "#fcd34d" };

  const t = {
    valuationSummary: isZh ? "估值摘要" : "Valuation Summary for",
    modelComparison: isZh ? "模型估值对比" : "Model Estimates Comparison",
    dcfModel: isZh ? "DCF 模型" : "DCF Model",
    relativeModel: isZh ? "相对估值" : "Relative Valuation",
    relRange: isZh ? "区间" : "Range",
    peers: isZh ? "可比公司" : "Peers",
    currentPrice: isZh ? "当前价格" : "Current Price",
    marketPrice: isZh ? "市场价格" : "Market Price",
    selectedMethod: isZh ? "选用方法" : "Selected Method",
    relativeValuation: isZh ? "相对估值" : "Relative Valuation",
    targetPrice: isZh ? "目标价格" : "Target Price",
    recommendation: isZh ? "建议" : "Recommendation",
    confidence: isZh ? "置信度" : "Confidence",
    rationale: isZh ? "分析依据" : "Rationale",
    reverseDcfTitle: isZh ? "反向 DCF 验证" : "Reverse DCF Verification",
    impliedGrowth: isZh ? "隐含增长率" : "Implied Growth",
    expectedGrowth: isZh ? "预期增长率" : "Expected Growth",
    verdict: isZh ? "结论" : "Verdict",
  };

  const sectionLabel = (txt: string) =>
    `<div style="font-size:10px; font-weight:600; color:#6b7280; text-transform:uppercase; letter-spacing:0.06em; margin-bottom:10px;">${txt}</div>`;

  return `
    <div style="background:#ffffff; border-radius:12px; box-shadow:0 2px 12px rgba(0,0,0,0.10); overflow:hidden; width:100%; box-sizing:border-box; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">

      <!-- ── Header ── -->
      <div style="background:linear-gradient(135deg,#667eea 0%,#764ba2 100%); padding:14px 16px; color:#fff;">
        <div style="display:flex; justify-content:space-between; align-items:center; gap:8px; flex-wrap:wrap;">
          <div style="font-size:15px; font-weight:700; display:flex; align-items:center; gap:6px; flex:1; min-width:0; overflow:hidden;">
            💰 <span style="overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${t.valuationSummary} ${ticker}</span>
          </div>
          ${recommendation ? `<span style="background:${recColor.bg}; color:${recColor.text}; border:1.5px solid ${recColor.border}; padding:4px 12px; border-radius:20px; font-size:11px; font-weight:700; white-space:nowrap; flex-shrink:0;">${recommendation}</span>` : ""}
        </div>
      </div>

      <!-- ── Model Estimates (always 3 cols; min-width:0 prevents overflow) ── -->
      <div style="padding:14px 16px; border-bottom:1px solid #e5e7eb;">
        ${sectionLabel(t.modelComparison)}
        <div style="display:grid; grid-template-columns:repeat(3,1fr); gap:12px;">

          <div style="border-left:3px solid #3b82f6; padding-left:10px; min-width:0;">
            <div style="font-size:10px; color:#6b7280; margin-bottom:3px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">📊 ${t.dcfModel}</div>
            <div style="font-size:20px; font-weight:800; color:#1f2937; line-height:1.1;">${dcfPrice > 0 ? `$${dcfPrice.toFixed(2)}` : "N/A"}</div>
            ${dcfPrice > 0 ? `<div style="font-size:11px; font-weight:600; color:${upsideColor(dcfUpside)}; margin-top:3px;">${upsideSign(dcfUpside)}${dcfUpside.toFixed(1)}% ${upsideArrow(dcfUpside)}</div>` : ""}
          </div>

          <div style="border-left:3px solid #8b5cf6; padding-left:10px; min-width:0;">
            <div style="font-size:10px; color:#6b7280; margin-bottom:3px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">📈 ${t.relativeModel}</div>
            <div style="font-size:20px; font-weight:800; color:#1f2937; line-height:1.1;">${relMedianPrice > 0 ? `$${relMedianPrice.toFixed(2)}` : "N/A"}</div>
            ${relMedianPrice > 0 ? `<div style="font-size:11px; font-weight:600; color:${upsideColor(relativeUpside)}; margin-top:3px;">${upsideSign(relativeUpside)}${relativeUpside.toFixed(1)}% ${upsideArrow(relativeUpside)}</div>` : ""}
            ${relLowPrice > 0 && relHighPrice > 0 ? `<div style="font-size:10px; color:#9ca3af; margin-top:3px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${t.relRange}: $${relLowPrice.toFixed(0)}–$${relHighPrice.toFixed(0)}</div>` : ""}
            ${peers.length > 0 ? `<div style="font-size:10px; color:#9ca3af; margin-top:2px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${t.peers}: ${peers.join(", ")}</div>` : ""}
          </div>

          <div style="border-left:3px solid #10b981; padding-left:10px; min-width:0;">
            <div style="font-size:10px; color:#6b7280; margin-bottom:3px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">💵 ${t.currentPrice}</div>
            <div style="font-size:20px; font-weight:800; color:#1f2937; line-height:1.1;">$${currentPrice.toFixed(2)}</div>
            <div style="font-size:10px; color:#9ca3af; margin-top:3px;">${t.marketPrice}</div>
          </div>

        </div>
      </div>

      <!-- ── Reverse DCF Verification ── -->
      ${reverseDcf ? `
      <div style="padding:12px 16px; border-bottom:1px solid #e5e7eb; background:#f8fafc;">
        ${sectionLabel("🔬 " + t.reverseDcfTitle)}
        <div style="display:grid; grid-template-columns:repeat(3,1fr); gap:8px;">
          <div style="min-width:0;">
            <div style="font-size:10px; color:#6b7280; margin-bottom:3px;">${t.impliedGrowth}</div>
            <div style="font-size:15px; font-weight:700; color:#1f2937;">${reverseDcf.implied_growth_pct || "N/A"}</div>
          </div>
          <div style="min-width:0;">
            <div style="font-size:10px; color:#6b7280; margin-bottom:3px;">${t.expectedGrowth}</div>
            <div style="font-size:15px; font-weight:700; color:#1f2937;">${reverseDcf.expected_growth_pct || "N/A"}</div>
          </div>
          <div style="min-width:0;">
            <div style="font-size:10px; color:#6b7280; margin-bottom:3px;">${t.verdict}</div>
            <div style="font-size:12px; font-weight:700; color:#7c3aed; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${reverseDcf.verdict || "N/A"}</div>
          </div>
        </div>
      </div>` : ""}

      <!-- ── Target Price Summary ── -->
      <div style="padding:14px 16px;">
        <div style="background:linear-gradient(135deg,#fffbeb 0%,#fef3c7 100%); border:1.5px solid #f59e0b; border-radius:10px; padding:14px;">
          <div style="display:grid; grid-template-columns:repeat(3,1fr); gap:8px; text-align:center;">

            <div style="min-width:0;">
              <div style="font-size:9px; font-weight:600; color:#92400e; text-transform:uppercase; letter-spacing:0.06em; margin-bottom:4px;">${t.selectedMethod}</div>
              <div style="font-size:13px; font-weight:700; color:#451a03; line-height:1.3; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">
                ${method === "RelativeMedian" ? t.relativeValuation : method === "DCF" ? t.dcfModel : method}
              </div>
            </div>

            <div style="min-width:0; border-left:1px solid #fcd34d; border-right:1px solid #fcd34d;">
              <div style="font-size:9px; font-weight:600; color:#92400e; text-transform:uppercase; letter-spacing:0.06em; margin-bottom:4px;">${t.targetPrice}</div>
              <div style="font-size:22px; font-weight:800; color:#451a03; line-height:1.1;">$${targetPrice.toFixed(2)}</div>
              <div style="font-size:11px; font-weight:700; color:${upsideColor(finalUpside)}; margin-top:3px;">${upsideSign(finalUpside)}${finalUpside.toFixed(1)}% ${upsideArrow(finalUpside)}</div>
            </div>

            <div style="min-width:0;">
              <div style="font-size:9px; font-weight:600; color:#92400e; text-transform:uppercase; letter-spacing:0.06em; margin-bottom:4px;">${t.confidence}</div>
              <div style="font-size:22px; font-weight:800; color:#451a03; line-height:1.1;">${confidence.toFixed(0)}%</div>
            </div>

          </div>
        </div>

        ${rationale ? `
        <div style="margin-top:12px; padding:10px 12px; background:#f9fafb; border-radius:8px; border-left:3px solid #d1d5db;">
          <div style="font-size:10px; font-weight:700; color:#374151; text-transform:uppercase; letter-spacing:0.06em; margin-bottom:4px;">${t.rationale}</div>
          <div style="font-size:12px; color:#4b5563; line-height:1.6;">${rationale}</div>
        </div>` : ""}

        ${(() => {
          const a = dcf.assumptions || dcf.dcf_valuation?.assumptions || {};
          const fmtPct = (v: any) => (v != null && v !== 0) ? `${(Number(v) * (Number(v) > 1 ? 1 : 100)).toFixed(1)}%` : null;
          const fmtNum = (v: any) => (v != null && v !== 0) ? Number(v).toFixed(2) : null;
          const items: [string, string | null][] = [
            [isZh ? "Beta" : "Beta", fmtNum(a.beta)],
            [isZh ? "营收增长" : "Rev Growth", fmtPct(a.revenue_growth ?? a.revenue_growth_rate)],
            [isZh ? "毛利率" : "Gross Margin", fmtPct(a.gross_margin)],
            [isZh ? "税率" : "Tax Rate", fmtPct(a.tax_rate)],
            [isZh ? "终值增长" : "Terminal Growth", fmtPct(a.terminal_growth ?? a.terminal_growth_rate)],
            [isZh ? "无风险利率" : "Risk-Free Rate", fmtPct(a.risk_free_rate)],
            [isZh ? "市场风险溢价" : "Mkt Risk Prem", fmtPct(a.market_risk_premium)],
            [isZh ? "预测年数" : "Proj. Years", a.projection_years ? String(a.projection_years) : null],
          ].filter(([, v]) => v !== null) as [string, string][];
          if (items.length === 0) return "";
          return `
        <div style="margin-top:10px; padding:10px 12px; background:#f0f9ff; border-radius:8px; border-left:3px solid #38bdf8;">
          <div style="font-size:10px; font-weight:700; color:#0369a1; text-transform:uppercase; letter-spacing:0.06em; margin-bottom:8px;">${isZh ? "DCF 假设参数" : "DCF Assumptions"}</div>
          <div style="display:grid; grid-template-columns:repeat(4,1fr); gap:6px;">
            ${items.map(([label, val]) => `<div style="min-width:0;"><div style="font-size:9px; color:#64748b; margin-bottom:2px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${label}</div><div style="font-size:12px; font-weight:700; color:#0c4a6e;">${val}</div></div>`).join("")}
          </div>
        </div>`;
        })()}
      </div>

    </div>`;
}
