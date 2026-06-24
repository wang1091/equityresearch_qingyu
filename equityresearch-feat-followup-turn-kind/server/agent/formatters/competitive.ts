// server/agent/formatters/competitive.ts
// Extracted verbatim from cardFormatter.ts (per-source split) — no behavior change.
import {
  formatErrorCard,
} from "./_shared";

// NOTE: currently unreachable via the live SSE path. Single-COMPETITIVE intent
// streams the structured `competitive` payload (index.ts) whenever success===true,
// and a success:false/{error} payload bails to the LLM stream — so this HTML
// fallback only fires for a caller that doesn't wire onPayload (none today).
// Kept intentionally as the no-onPayload fallback; do not assume it's exercised.
export function formatCompetitiveCard(data: any, language: string = "en"): string {
  const isZh = language === "zh";

  // ✅ 适配实际API返回的扁平结构（不再需要 zh/en 嵌套）
  const forces = data.forces;
  const overallAssessment = data.overall_assessment;

  if (!forces) {
    return formatErrorCard("COMPETITIVE", "Invalid competitive analysis data format");
  }

  const forceLabels: Record<string, { en: string; zh: string; icon: string }> = {
    competitive_rivalry: { en: "Competitive Rivalry", zh: "竞争对手的竞争", icon: "🔄" },
    threat_of_new_entrants: { en: "Threat of New Entrants", zh: "新进入者的威胁", icon: "🚪" },
    threat_of_substitutes: { en: "Threat of Substitutes", zh: "替代品的威胁", icon: "🔀" },
    supplier_power: { en: "Supplier Power", zh: "供应商议价能力", icon: "💼" },
    buyer_power: { en: "Buyer Power", zh: "买家议价能力", icon: "🛒" },
  };

  const forcesHtml = Object.entries(forces)
    .map(([key, force]: [string, any]) => {
      const label = forceLabels[key] || { en: key, zh: key, icon: "📊" };
      const scoreColor = force.score >= 7 ? "#ef4444" : force.score >= 4 ? "#f59e0b" : "#10b981";

      return `
      <div style="border: 1px solid #e5e7eb; border-radius: 8px; padding: 16px;">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;">
          <span style="font-weight: 600; color: #374151;">${label.icon} ${isZh ? label.zh : label.en}</span>
          <span style="background: ${scoreColor}; color: white; padding: 4px 12px; border-radius: 12px; font-weight: 600;">${force.score}/10</span>
        </div>
        <div style="background: #f3f4f6; border-radius: 4px; height: 8px; margin-bottom: 12px;">
          <div style="background: ${scoreColor}; height: 100%; border-radius: 4px; width: ${force.score * 10}%;"></div>
        </div>
        <p style="color: #6b7280; font-size: 14px; line-height: 1.5; margin: 0;">${force.analysis}</p>
      </div>`;
    })
    .join("");

  return `
    <div style="background: white; border-radius: 12px; box-shadow: 0 2px 8px rgba(0,0,0,0.1); overflow: hidden;">
      <div style="background: linear-gradient(135deg, #0d9488 0%, #14b8a6 100%); padding: 16px 20px; color: white;">
        <h3 style="margin: 0;">🏭 ${data.company} - ${isZh ? "行业竞争力分析" : "Competitive Analysis"}</h3>
        <p style="margin: 4px 0 0 0; opacity: 0.9; font-size: 14px;">${data.industry}</p>
      </div>
      ${data.research_grounded === false ? `
      <div style="background: #fef3c7; border-bottom: 1px solid #fcd34d; padding: 12px 20px; color: #92400e; font-size: 13px; line-height: 1.5;">
        <strong>⚠️ ${isZh ? "提示" : "Notice"}：</strong>${isZh
          ? "此分析未使用实时网络研究素材，仅基于 LLM 训练数据生成；信息可能不反映近期市场动态，对小盘股 / 近期 IPO / 新兴公司尤需谨慎核实。"
          : "Analysis generated without real-time web research; based on LLM training data only. May not reflect recent events, especially for small caps, recent IPOs, or emerging companies."}
      </div>` : ""}
      <div style="padding: 20px;">
        <div style="background: #f0fdfa; border-left: 4px solid #14b8a6; padding: 16px; border-radius: 8px; margin-bottom: 20px;">
          <strong style="color: #0f766e;">${isZh ? "总体评估" : "Overall Assessment"}</strong>
          <p style="margin: 8px 0 0 0; color: #374151; line-height: 1.6;">${overallAssessment}</p>
        </div>
        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 16px;">
          ${forcesHtml}
        </div>
      </div>
    </div>`;
}
