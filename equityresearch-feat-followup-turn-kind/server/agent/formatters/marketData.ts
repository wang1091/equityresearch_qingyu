// server/agent/formatters/marketData.ts
// Extracted verbatim from cardFormatter.ts (per-source split) — no behavior change.
import {
  escapeHtml,
} from "./_shared";

export function formatMarketDataCard(data: any, language: string = "en"): string {
  const isZh = language === "zh";

  if (!data?.success) {
    const msg = isZh ? "市场数据暂时不可用" : "Market data unavailable";
    return `<div style="padding:14px 16px; background:#fff7ed; border-left:4px solid #f59e0b; border-radius:8px; font-size:13px; color:#92400e;">${msg}</div>`;
  }

  const quotes: any[] = data.quotes || [];
  const calc: any = data.calculated || {};
  const hist: Record<string, any[]> = data.historical || {};
  const queryType: string = data.queryType || "general";
  const provider: string = data.provider || "fmp";
  const fetchedAt: string = data.fetchedAt ? new Date(data.fetchedAt).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" }) : "";

  const fmtPct = (v: number | null | undefined, decimals = 2) =>
    v == null ? "—" : `${v >= 0 ? "+" : ""}${v.toFixed(decimals)}%`;
  const fmtPrice = (v: number | null | undefined) =>
    v == null ? "—" : `$${v.toFixed(2)}`;
  const fmtLarge = (v: number | null | undefined): string => {
    if (v == null) return "—";
    if (Math.abs(v) >= 1e12) return `$${(v / 1e12).toFixed(2)}T`;
    if (Math.abs(v) >= 1e9) return `$${(v / 1e9).toFixed(2)}B`;
    if (Math.abs(v) >= 1e6) return `$${(v / 1e6).toFixed(2)}M`;
    return `$${v.toFixed(0)}`;
  };
  const fmtVol = (v: number | null | undefined): string => {
    if (v == null) return "—";
    if (v >= 1e9) return `${(v / 1e9).toFixed(2)}B`;
    if (v >= 1e6) return `${(v / 1e6).toFixed(2)}M`;
    if (v >= 1e3) return `${(v / 1e3).toFixed(0)}K`;
    return String(v);
  };

  const pctColor = (v: number | null | undefined) =>
    v == null ? "#6b7280" : v >= 0 ? "#10b981" : "#ef4444";

  // ── Quote cards ──
  const quoteCards = quotes.map((q: any) => {
    const chgPct = q.changePercent ?? 0;
    const isUp = chgPct >= 0;
    const arrow = isUp ? "▲" : "▼";
    const color = pctColor(chgPct);

    const rowCandidates: Array<[string, string]> = [
      [isZh ? "当前价格" : "Price",       fmtPrice(q.price)],
      [isZh ? "涨跌"     : "Change",      `${isUp ? "+" : ""}${q.change?.toFixed(2) ?? "—"} (${fmtPct(chgPct)})`],
      [isZh ? "市值"     : "Market Cap",  fmtLarge(q.marketCap)],
      [isZh ? "成交量"   : "Volume",      fmtVol(q.volume)],
      [isZh ? "市盈率"   : "P/E",         q.pe != null ? `${q.pe.toFixed(1)}x` : "—"],
      [isZh ? "市销率"   : "P/S",         q.ps != null ? `${q.ps.toFixed(1)}x` : "—"],
      [isZh ? "EV/EBITDA": "EV/EBITDA",  q.evEbitda != null ? `${q.evEbitda.toFixed(1)}x` : "—"],
      [isZh ? "股息率"   : "Div Yield",   q.dividendYield != null ? `${q.dividendYield.toFixed(2)}%` : "—"],
      [isZh ? "年初至今" : "YTD Return",  q.ytdReturn != null ? fmtPct(q.ytdReturn) : "—"],
      [isZh ? "52周高"   : "52W High",    fmtPrice(q.fiftyTwoWeekHigh)],
      [isZh ? "52周低"   : "52W Low",     fmtPrice(q.fiftyTwoWeekLow)],
      [isZh ? "Beta"     : "Beta",        q.beta != null ? q.beta.toFixed(2) : "—"],
    ];
    const rows: Array<[string, string]> = rowCandidates.filter(([, v]) => v !== "—");

    return `
      <div style="background:#fff; border:1px solid #e5e7eb; border-radius:10px; overflow:hidden; margin-bottom:12px;">
        <div style="background:linear-gradient(135deg,#1e293b 0%,#334155 100%); padding:12px 16px; color:#fff; display:flex; justify-content:space-between; align-items:center;">
          <div>
            <div style="font-size:15px; font-weight:700;">${escapeHtml(q.ticker)}</div>
            <div style="font-size:11px; opacity:0.7;">${escapeHtml(q.companyName || "")} · ${escapeHtml(q.exchange || "")}</div>
          </div>
          <div style="text-align:right;">
            <div style="font-size:20px; font-weight:800;">${fmtPrice(q.price)}</div>
            <div style="font-size:12px; font-weight:600; color:${color};">${arrow} ${fmtPct(chgPct)}</div>
          </div>
        </div>
        <div style="padding:12px 16px; display:grid; grid-template-columns:repeat(2,1fr); gap:8px;">
          ${rows.map(([label, val]) => `
            <div style="background:#f8fafc; border-radius:6px; padding:8px 10px;">
              <div style="font-size:10px; color:#6b7280; margin-bottom:2px;">${label}</div>
              <div style="font-size:13px; font-weight:600; color:#1f2937;">${val}</div>
            </div>`).join("")}
        </div>
      </div>`;
  }).join("");

  // ── Calculated metrics (returns, portfolio) ──
  let calcHtml = "";
  if (Object.keys(calc).length > 0) {
    const items: [string, string][] = [
      [isZh ? "年初至今回报" : "YTD Return",       calc.ytdReturnPct ?? ""],
      [isZh ? "总回报"       : "Total Return",      calc.totalReturnPct ?? ""],
      [isZh ? "初始投资"     : "Invested",          calc.hypotheticalInvested ?? ""],
      [isZh ? "当前价值"     : "Current Value",     calc.hypotheticalValue ?? ""],
      [isZh ? "市值"         : "Market Cap",        calc.marketCapFmt ?? ""],
      [isZh ? "市盈率"       : "P/E",               calc.peRatio ?? ""],
      [isZh ? "市销率"       : "P/S",               calc.psRatio ?? ""],
      [isZh ? "EV/EBITDA"   : "EV/EBITDA",         calc.evEbitdaFmt ?? ""],
      [isZh ? "股息率"       : "Dividend Yield",    calc.dividendYieldPct ?? ""],
    ].filter(([, v]) => v.length > 0) as [string, string][];

    if (items.length > 0) {
      calcHtml = `
        <div style="background:#f0fdf4; border:1px solid #86efac; border-radius:10px; padding:14px 16px; margin-bottom:12px;">
          <div style="font-size:11px; font-weight:700; color:#166534; text-transform:uppercase; letter-spacing:0.06em; margin-bottom:10px;">
            ${isZh ? "📊 计算结果" : "📊 Calculated Results"}
          </div>
          <div style="display:grid; grid-template-columns:repeat(2,1fr); gap:8px;">
            ${items.map(([label, val]) => `
              <div style="background:#fff; border-radius:6px; padding:8px 10px; border:1px solid #dcfce7;">
                <div style="font-size:10px; color:#6b7280; margin-bottom:2px;">${label}</div>
                <div style="font-size:14px; font-weight:700; color:#166534;">${escapeHtml(val)}</div>
              </div>`).join("")}
          </div>
        </div>`;
    }
  }

  // ── Historical data note (for comparison) ──
  let histHtml = "";
  const histTickers = Object.keys(hist);
  if (histTickers.length > 1 && queryType === "comparison") {
    const comparisons = histTickers.map((t) => {
      const points = hist[t];
      if (!points || points.length < 2) return null;
      const start = points[0].close;
      const end = points[points.length - 1].close;
      const ret = ((end - start) / start) * 100;
      return { ticker: t, ret };
    }).filter(Boolean) as { ticker: string; ret: number }[];
    comparisons.sort((a, b) => b.ret - a.ret);
    if (comparisons.length > 1) {
      histHtml = `
        <div style="background:#f8fafc; border:1px solid #e2e8f0; border-radius:10px; padding:14px 16px; margin-bottom:12px;">
          <div style="font-size:11px; font-weight:700; color:#475569; text-transform:uppercase; letter-spacing:0.06em; margin-bottom:8px;">
            ${isZh ? "📈 回报对比" : "📈 Return Comparison"}
          </div>
          ${comparisons.map((c, i) => `
            <div style="display:flex; justify-content:space-between; align-items:center; padding:6px 0; border-bottom:${i < comparisons.length - 1 ? "1px solid #e2e8f0" : "none"};">
              <div style="font-size:13px; font-weight:600; color:#1e293b;">${c.ticker}</div>
              <div style="font-size:14px; font-weight:700; color:${c.ret >= 0 ? "#10b981" : "#ef4444"};">${fmtPct(c.ret)}</div>
            </div>`).join("")}
        </div>`;
    }
  }

  return `
    <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
      ${calcHtml}${histHtml}${quoteCards}
      <div style="font-size:10px; color:#9ca3af; text-align:right; margin-top:4px;">
        ${isZh ? "数据来源" : "Source"}: ${provider.toUpperCase()} · ${fetchedAt}
      </div>
    </div>`;
}
