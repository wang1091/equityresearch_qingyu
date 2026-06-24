// server/agent/formatters/trending.ts
// Extracted verbatim from cardFormatter.ts (per-source split) — no behavior change.
import {
  escapeHtml,
} from "./_shared";

export function formatTrendingCard(data: any, language: string = "en"): string {
  const isZh = language === "zh";

  // API failure — return a consistent unavailable card so all categories
  // show the same UI regardless of whether the upstream timed out.
  if (!data || data.success === false) {
    const msg = isZh ? "行情数据暂时不可用，请稍后重试" : "Market data temporarily unavailable — please try again shortly";
    return `<div style="background:#fff; border-radius:12px; box-shadow:0 2px 10px rgba(0,0,0,0.08); overflow:hidden; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
      <div style="background:linear-gradient(135deg,#1e293b 0%,#334155 100%); padding:14px 18px; color:#fff;">
        <div style="font-size:15px; font-weight:700;">📊 ${isZh ? "今日市场行情" : "Today's Market Movers"}</div>
      </div>
      <div style="padding:20px 18px; color:#6b7280; font-size:13px; text-align:center;">${msg}</div>
    </div>`;
  }

  const date = data.date || new Date().toISOString().split("T")[0];

  const categoryMeta: Record<string, { icon: string; labelEn: string; labelZh: string; color: string }> = {
    most_discussed: { icon: "💬", labelEn: "Most Discussed",  labelZh: "最热门讨论", color: "#6366f1" },
    most_active:    { icon: "🔥", labelEn: "Most Active",     labelZh: "最活跃交易", color: "#f59e0b" },
    top_gainers:    { icon: "📈", labelEn: "Top Gainers",     labelZh: "涨幅最大",   color: "#10b981" },
    top_losers:     { icon: "📉", labelEn: "Top Losers",      labelZh: "跌幅最大",   color: "#ef4444" },
  };

  const categories: any[] = Array.isArray(data.categories)
    ? data.categories
    : data.category && data.category.id
      ? [data.category]          // category-specific endpoint: { category: { id, stocks } }
      : data.id
        ? [data]
        : [];

  if (categories.length === 0) {
    return `<div style="padding:16px; color:#6b7280;">${isZh ? "暂无行情数据" : "No trending data available"}</div>`;
  }

  const fmtPct = (v: number | undefined) => {
    if (v == null) return "—";
    const sign = v >= 0 ? "+" : "";
    return `${sign}${v.toFixed(2)}%`;
  };
  const fmtPrice = (v: number | undefined) => v != null ? `$${v.toFixed(2)}` : "—";
  const pctColor = (v: number | undefined) => (v == null ? "#6b7280" : v >= 0 ? "#10b981" : "#ef4444");

  const renderCategory = (cat: any) => {
    const meta = categoryMeta[cat.id] || { icon: "📊", labelEn: cat.label || cat.id, labelZh: cat.label || cat.id, color: "#6366f1" };
    const label = isZh ? meta.labelZh : meta.labelEn;
    const stocks: any[] = (cat.stocks || []).slice(0, 10);
    const rows = stocks.map((s: any, i: number) => {
      const pct = s.changePercent;
      const highlight = s.discussion_highlights?.[0] ? `<div style="font-size:10px; color:#9ca3af; margin-top:1px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${escapeHtml(s.discussion_highlights[0])}</div>` : "";
      return `
        <tr style="border-bottom:1px solid #f3f4f6;">
          <td style="padding:7px 10px; font-size:12px; color:#6b7280;">${i + 1}</td>
          <td style="padding:7px 4px;">
            <div style="font-size:13px; font-weight:700; color:#1f2937;">${escapeHtml(s.ticker)}</div>
            <div style="font-size:10px; color:#9ca3af; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; max-width:120px;">${escapeHtml(s.companyName || "")}</div>
            ${highlight}
          </td>
          <td style="padding:7px 10px; text-align:right; font-size:13px; font-weight:600; color:#1f2937;">${fmtPrice(s.price)}</td>
          <td style="padding:7px 10px; text-align:right; font-size:13px; font-weight:700; color:${pctColor(pct)};">${fmtPct(pct)}</td>
        </tr>`;
    }).join("");

    return `
      <div style="margin-bottom:16px;">
        <div style="display:flex; align-items:center; gap:6px; margin-bottom:8px;">
          <span style="font-size:16px;">${meta.icon}</span>
          <span style="font-size:13px; font-weight:700; color:${meta.color};">${label}</span>
          <span style="font-size:11px; color:#9ca3af; margin-left:auto;">${isZh ? "前10" : "Top 10"}</span>
        </div>
        <div style="border-radius:8px; overflow:hidden; border:1px solid #e5e7eb;">
          <table style="width:100%; border-collapse:collapse; font-size:12px; background:#fff;">
            <thead>
              <tr style="background:#f8fafc; border-bottom:2px solid #e2e8f0;">
                <th style="padding:7px 10px; text-align:left; color:#9ca3af; font-size:10px; font-weight:600; width:28px;">#</th>
                <th style="padding:7px 4px; text-align:left; color:#9ca3af; font-size:10px; font-weight:600;">${isZh ? "股票" : "Stock"}</th>
                <th style="padding:7px 10px; text-align:right; color:#9ca3af; font-size:10px; font-weight:600;">${isZh ? "价格" : "Price"}</th>
                <th style="padding:7px 10px; text-align:right; color:#9ca3af; font-size:10px; font-weight:600;">${isZh ? "涨跌" : "Change"}</th>
              </tr>
            </thead>
            <tbody>${rows}</tbody>
          </table>
        </div>
      </div>`;
  };

  const body = categories.map(renderCategory).join("");

  return `
    <div style="background:#fff; border-radius:12px; box-shadow:0 2px 10px rgba(0,0,0,0.08); overflow:hidden; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
      <div style="background:linear-gradient(135deg,#1e293b 0%,#334155 100%); padding:14px 18px; color:#fff;">
        <div style="font-size:15px; font-weight:700;">📊 ${isZh ? "今日市场行情" : "Today's Market Movers"}</div>
        <div style="font-size:11px; opacity:0.7; margin-top:3px;">${isZh ? "数据来源: Yahoo Finance · X" : "Source: Yahoo Finance · X"} · ${date}</div>
      </div>
      <div style="padding:16px;">${body}</div>
    </div>`;
}
