// server/agent/formatters/rating.ts
// Extracted verbatim from cardFormatter.ts (per-source split) — no behavior change.
import {
  getLocale,
  localizeDirection,
} from "./_shared";

export function formatRatingCard(data: any, language: string = "en"): string {
  const isZh = language === "zh";
  const ticker = data.ticker || "N/A";
  const price = data.price || 0;
  const rating = data.rating || "N/A";
  const provider = data.provider || null;

  const technical = data.technical || {};
  const valuation = data.valuation || {};
  const levels = data.levels || {};
  const latestNews = data.news?.headline || null;
  const scores = data.scores || {};
  const reports = data.reports || [];
  const bullish = data.bullish || [];
  const bearish = data.bearish || [];

  const ratingColor = (() => {
    const r = (rating || "").toLowerCase();
    if (r.includes("buy") || r.includes("bullish") || r.includes("买入") || r.includes("看多")) return "#10b981";
    if (r.includes("sell") || r.includes("bearish") || r.includes("卖出") || r.includes("看空")) return "#ef4444";
    return "#f59e0b";
  })();

  const dirIcon = (dir: string | null) => {
    if (!dir) return "—";
    const normalized = dir.toLowerCase();
    if (normalized === "bullish" || normalized.includes("看多")) return "🟢";
    if (normalized === "bearish" || normalized.includes("看空")) return "🔴";
    return "🟡";
  };

  const scoreBar = (label: string, value: number | null) => {
    if (value === null) return "";
    const pct = (value * 100).toFixed(0);
    const color = value > 0.7 ? "#10b981" : value > 0.4 ? "#f59e0b" : "#ef4444";
    return `
    <div style="margin-bottom: 8px;">
      <div style="display: flex; justify-content: space-between; font-size: 12px; color: #374151; margin-bottom: 3px;">
        <span>${label}</span><span style="color:${color}; font-weight:600;">${pct}%</span>
      </div>
      <div style="background: #e5e7eb; border-radius: 4px; height: 6px;">
        <div style="background: ${color}; width: ${pct}%; height: 6px; border-radius: 4px;"></div>
      </div>
    </div>`;
  };

  const t = {
    title: isZh ? "分析师评级" : "Analyst Rating",
    consensus: isZh ? "综合评级" : "Consensus Rating",
    by: isZh ? "来源" : "by",
    currentPrice: isZh ? "当前价格" : "Current Price",
    target: isZh ? "目标价" : "Target",
    techOutlook: isZh ? "技术面展望" : "Technical Outlook",
    shortTerm: isZh ? "短期" : "Short-term",
    midTerm: isZh ? "中期" : "Mid-term",
    longTerm: isZh ? "长期" : "Long-term",
    vsSector: isZh ? "对比板块" : "vs Sector",
    vsIndex: isZh ? "对比指数" : "vs Index",
    support: isZh ? "支撑位" : "Support",
    resistance: isZh ? "阻力位" : "Resistance",
    stopLoss: isZh ? "止损位" : "Stop Loss",
    valuation: isZh ? "估值" : "Valuation",
    companyScores: isZh ? "公司评分" : "Company Scores",
    innovativeness: isZh ? "创新能力" : "Innovativeness",
    hiring: isZh ? "招聘" : "Hiring",
    sustainability: isZh ? "可持续发展" : "Sustainability",
    insiderSentiments: isZh ? "内部人情绪" : "Insider Sentiments",
    earningsReports: isZh ? "财报表现" : "Earnings Reports",
    dividends: isZh ? "分红" : "Dividends",
    bullish: isZh ? "看多" : "Bullish",
    bearish: isZh ? "看空" : "Bearish",
    latestReports: isZh ? "最新研报" : "Latest Reports",
    latest: isZh ? "最新" : "Latest",
  };

  return `<strong>⭐ ${t.title} - ${ticker}</strong><br><br>
    <div style="background: white; border-radius: 12px; box-shadow: 0 2px 8px rgba(0,0,0,0.1); overflow: hidden;">

      <div style="background: linear-gradient(135deg, #1e40af 0%, #3b82f6 100%); padding: 16px 20px; color: white;">
        <div style="display: flex; justify-content: space-between; align-items: center;">
          <div>
            <div style="font-size: 12px; opacity: 0.8;">${t.consensus}</div>
            <div style="font-size: 24px; font-weight: bold; margin-top: 4px;">
              <span style="background: ${ratingColor}; padding: 4px 14px; border-radius: 8px;">${rating}</span>
            </div>
            ${provider ? `<div style="font-size: 11px; opacity: 0.7; margin-top: 6px;">${t.by} ${provider}</div>` : ""}
          </div>
          <div style="text-align: right;">
            <div style="font-size: 12px; opacity: 0.8;">${t.currentPrice}</div>
            <div style="font-size: 22px; font-weight: bold; margin-top: 4px;">$${Number(price).toFixed(2)}</div>
            <div style="font-size: 12px; opacity: 0.7; margin-top: 4px;">${t.target}: N/A</div>
          </div>
        </div>
      </div>

      <div style="padding: 16px;">

        <div style="margin-bottom: 16px;">
          <div style="font-weight: 600; color: #374151; margin-bottom: 8px;">📊 ${t.techOutlook}</div>
          <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px;">
            <div style="padding: 10px; background: #f9fafb; border-radius: 8px; text-align: center;">
              <div style="font-size: 11px; color: #6b7280;">${t.shortTerm}</div>
              <div style="font-size: 18px; margin-top: 4px;">${dirIcon(technical.short?.direction)}</div>
              <div style="font-size: 12px; font-weight: 600; color: #374151;">${localizeDirection(technical.short?.direction, language)}</div>
              ${technical.short?.desc ? `<div style="font-size: 10px; color: #9ca3af; margin-top: 2px;">${technical.short.desc}</div>` : ""}
            </div>
            <div style="padding: 10px; background: #f9fafb; border-radius: 8px; text-align: center;">
              <div style="font-size: 11px; color: #6b7280;">${t.midTerm}</div>
              <div style="font-size: 18px; margin-top: 4px;">${dirIcon(technical.mid?.direction)}</div>
              <div style="font-size: 12px; font-weight: 600; color: #374151;">${localizeDirection(technical.mid?.direction, language)}</div>
              ${technical.mid?.desc ? `<div style="font-size: 10px; color: #9ca3af; margin-top: 2px;">${technical.mid.desc}</div>` : ""}
            </div>
            <div style="padding: 10px; background: #f9fafb; border-radius: 8px; text-align: center;">
              <div style="font-size: 11px; color: #6b7280;">${t.longTerm}</div>
              <div style="font-size: 18px; margin-top: 4px;">${dirIcon(technical.long?.direction)}</div>
              <div style="font-size: 12px; font-weight: 600; color: #374151;">${localizeDirection(technical.long?.direction, language)}</div>
              ${technical.long?.desc ? `<div style="font-size: 10px; color: #9ca3af; margin-top: 2px;">${technical.long.desc}</div>` : ""}
            </div>
          </div>
          <div style="display: flex; gap: 8px; margin-top: 8px;">
            ${technical.vsSector ? `
            <div style="flex:1; padding: 6px 10px; background: #f3f4f6; border-radius: 6px; font-size: 12px; text-align: center;">
              <span style="color: #6b7280;">${t.vsSector}</span>
              <span style="font-weight: 600; margin-left: 4px;">${dirIcon(technical.vsSector)} ${localizeDirection(technical.vsSector, language)}</span>
            </div>` : ""}
            ${technical.vsIndex ? `
            <div style="flex:1; padding: 6px 10px; background: #f3f4f6; border-radius: 6px; font-size: 12px; text-align: center;">
              <span style="color: #6b7280;">${t.vsIndex}</span>
              <span style="font-weight: 600; margin-left: 4px;">${dirIcon(technical.vsIndex)} ${localizeDirection(technical.vsIndex, language)}</span>
            </div>` : ""}
          </div>
        </div>

        <div style="margin-bottom: 16px; display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px;">
          ${levels.support ? `
          <div style="padding: 10px; background: #ecfdf5; border-radius: 8px; text-align: center;">
            <div style="font-size: 11px; color: #065f46;">${t.support}</div>
            <div style="font-size: 16px; font-weight: bold; color: #10b981;">$${Number(levels.support).toFixed(2)}</div>
          </div>` : ""}
          ${levels.resistance ? `
          <div style="padding: 10px; background: #fef2f2; border-radius: 8px; text-align: center;">
            <div style="font-size: 11px; color: #991b1b;">${t.resistance}</div>
            <div style="font-size: 16px; font-weight: bold; color: #ef4444;">$${Number(levels.resistance).toFixed(2)}</div>
          </div>` : ""}
          ${levels.stopLoss ? `
          <div style="padding: 10px; background: #fff7ed; border-radius: 8px; text-align: center;">
            <div style="font-size: 11px; color: #92400e;">${t.stopLoss}</div>
            <div style="font-size: 16px; font-weight: bold; color: #f97316;">$${Number(levels.stopLoss).toFixed(2)}</div>
          </div>` : ""}
        </div>

        ${valuation.status ? `
        <div style="padding: 10px; background: #eff6ff; border-left: 3px solid #3b82f6; border-radius: 6px; margin-bottom: 16px;">
          <span style="font-weight: 600; color: #1e40af;">${t.valuation}:</span> ${valuation.status}
          ${valuation.discount ? ` (${valuation.discount})` : ""}
        </div>` : ""}

        ${Object.values(scores).some(v => v !== null) ? `
        <div style="margin-bottom: 16px;">
          <div style="font-weight: 600; color: #374151; margin-bottom: 8px;">🏢 ${t.companyScores}</div>
          ${scoreBar(t.innovativeness, scores.innovativeness)}
          ${scoreBar(t.hiring, scores.hiring)}
          ${scoreBar(t.sustainability, scores.sustainability)}
          ${scoreBar(t.insiderSentiments, scores.insiderSentiments)}
          ${scoreBar(t.earningsReports, scores.earningsReports)}
          ${scores.dividends !== null ? scoreBar(t.dividends, scores.dividends) : ""}
        </div>` : ""}

        ${bullish.length || bearish.length ? `
        <div style="margin-bottom: 16px; display: grid; grid-template-columns: 1fr 1fr; gap: 12px;">
          ${bullish.length ? `
          <div>
            <div style="font-weight: 600; color: #10b981; margin-bottom: 6px;">🟢 ${t.bullish}</div>
            ${bullish.map((b: string) => `<div style="font-size: 12px; color: #374151; padding: 4px 0; border-bottom: 1px solid #f3f4f6;">• ${b}</div>`).join("")}
          </div>` : ""}
          ${bearish.length ? `
          <div>
            <div style="font-weight: 600; color: #ef4444; margin-bottom: 6px;">🔴 ${t.bearish}</div>
            ${bearish.map((b: string) => `<div style="font-size: 12px; color: #374151; padding: 4px 0; border-bottom: 1px solid #f3f4f6;">• ${b}</div>`).join("")}
          </div>` : ""}
        </div>` : ""}

        ${reports.length ? `
        <div style="margin-bottom: 16px;">
          <div style="font-weight: 600; color: #374151; margin-bottom: 8px;">📄 ${t.latestReports}</div>
          ${reports.map((r: any) => `
          <div style="padding: 8px; background: #f9fafb; border-radius: 6px; margin-bottom: 6px;">
            <div style="font-size: 13px; font-weight: 500; color: #111827;">${r.title || "N/A"}</div>
            <div style="font-size: 11px; color: #6b7280; margin-top: 3px;">${r.provider || ""} · ${r.date ? new Date(r.date).toLocaleDateString(getLocale(language)) : ""}</div>
          </div>`).join("")}
        </div>` : ""}

        ${latestNews ? `
        <div style="padding: 10px; background: #f0f9ff; border-left: 3px solid #3b82f6; border-radius: 6px;">
          <span style="font-weight: 600; color: #1e40af;">📰 ${t.latest}:</span> ${latestNews}
        </div>` : ""}

      </div>
    </div>`;
}
