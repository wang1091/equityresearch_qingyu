// server/agent/formatters/performance.ts
// Extracted verbatim from cardFormatter.ts (per-source split) — no behavior change.
import {
  getLocale,
  localizeMetricName,
  renderTrendChart,
  formatErrorCard,
} from "./_shared";

export function formatPerformanceCard(data: any, language: string = "en"): string {
  const isZh = language === "zh";
  const { analysis, metrics } = data;

  // analysis may be null when Yahoo Finance rate-limits primary-company-analysis.
  // Fall back to explicitly passed primaryTicker/peers from apiCaller.
  const ticker = analysis?.ticker || data.primaryTicker || Object.keys(metrics || {}).find(k => k !== "N/A") || "N/A";
  const peers: string[] = analysis?.peers || data.peers || [];
  const period = analysis?.period || "Latest";
  const allTickers = [ticker, ...peers];

  const tickerData = metrics?.[ticker];
  if (!tickerData) return formatErrorCard("PERFORMANCE", isZh ? "暂无指标数据" : "No metrics data");

  // 获取季度列表
  const quarters = tickerData["Total Revenue"]
    ? Object.keys(tickerData["Total Revenue"]).sort().reverse()
    : [];
  const latestQuarter = quarters[0];
  const displayQuarters = quarters.slice(0, 5);

  // 格式化数值
  const fmtVal = (value: number | null | undefined, metric: string): string => {
    if (value === undefined || value === null) return "—";
    if (metric === "Gross Margin %") return Number(value).toFixed(1) + "%";
    if (metric === "P/E Ratio" || metric === "Price/Sales") return Number(value).toFixed(2) + "x";
    const absValue = Math.abs(value);
    const sign = value < 0 ? "-" : "";
    if (absValue >= 1_000_000_000) return `${sign}$${(absValue / 1_000_000_000).toFixed(1)}B`;
    if (absValue >= 1_000_000) return `${sign}$${(absValue / 1_000_000).toFixed(0)}M`;
    if (absValue >= 1_000) return `${sign}$${(absValue / 1_000).toFixed(0)}K`;
    return `${sign}$${absValue.toFixed(0)}`;
  };

  const fmtPE = (v: any): string => {
    // P/E Ratio can be a number OR a quarterly object {"2026Q1": 32.63}
    let num: number | undefined;
    if (typeof v === "number") {
      num = v;
    } else if (v && typeof v === "object") {
      const vals = Object.values(v) as number[];
      num = vals[vals.length - 1]; // use most recent quarter value
    }
    if (!num || isNaN(num)) return "N/A";
    return Number(num).toFixed(1) + "x";
  };

  // 判断 verdict
  const conclusionText: string = isZh
    ? (data.peerConclusion?.zh || data.peerConclusion?.en || "")
    : (data.peerConclusion?.en || "");
  const analysisText: string = analysis?.analysis || conclusionText || "";
  // The LLM emits a structured object with an explicit `rating` field. Read it
  // directly instead of grepping for "Undervalued" anywhere in the bullets —
  // phrases like "supporting Undervalued rating" otherwise misfire when the
  // actual rating is Fairly Valued.
  const parsedRating: string | null = (() => {
    if (!analysisText) return null;
    const trimmed = analysisText.trim().replace(/^```json\s*|\s*```$/g, "");
    if (!trimmed.startsWith("{") || !trimmed.endsWith("}")) return null;
    try {
      const obj = JSON.parse(trimmed);
      if (obj && typeof obj === "object" && !Array.isArray(obj) && typeof obj.rating === "string") {
        return obj.rating.trim();
      }
    } catch {}
    return null;
  })();
  const ratingLc = parsedRating ? parsedRating.toLowerCase() : "";
  const isOvervalued = parsedRating
    ? (ratingLc === "overvalued" || parsedRating === "高估")
    : /Overvalued|高估/i.test(analysisText);
  const isUndervalued = parsedRating
    ? (ratingLc === "undervalued" || parsedRating === "低估")
    : /Undervalued|低估/i.test(analysisText);
  const verdictColor = isOvervalued ? "#ef4444" : isUndervalued ? "#10b981" : "#f59e0b";
  const verdictText = isOvervalued ? (isZh ? "高估" : "Overvalued") : isUndervalued ? (isZh ? "低估" : "Undervalued") : (isZh ? "合理" : "Fairly Valued");
  const verdictIcon = isOvervalued ? "⚠️" : isUndervalued ? "✅" : "➡️";

  // 格式化 analysis 文本
  const highlightNumbers = (s: string): string =>
    s
      .replace(/(-?\d+\.?\d*%)/g, '<strong style="color:#059669;">$1</strong>')
      .replace(/(\$[\d.]+[BMK]+)/g, '<strong style="color:#0891b2;">$1</strong>');

  // Upstream LLM (primary-company-analysis) now emits a structured JSON object,
  // not free-form prose. Render the known sections as titled bullet groups.
  const renderStructuredAnalysis = (obj: any): string => {
    const sections: Array<{ key: string; titleEn: string; titleZh: string; icon: string }> = [
      { key: "summary",               titleEn: "Summary",               titleZh: "总结",       icon: "📋" },
      { key: "financial_performance", titleEn: "Financial Performance", titleZh: "财务表现",   icon: "💰" },
      { key: "peer_comparison_rank",  titleEn: "Peer Comparison Rank",  titleZh: "同业排名",   icon: "🏆" },
      { key: "valuation_ratios",      titleEn: "Valuation Ratios",      titleZh: "估值比率",   icon: "📊" },
    ];
    const parts: string[] = [];
    for (const sec of sections) {
      const items = obj[sec.key];
      if (!Array.isArray(items) || items.length === 0) continue;
      const title = isZh ? sec.titleZh : sec.titleEn;
      const bullets = items
        .map((item) => `<div style="margin-left:12px; margin-top:4px; color:#374151;">• ${highlightNumbers(String(item))}</div>`)
        .join("");
      parts.push(`<div style="margin-top:10px;"><div style="font-weight:600; color:#1e40af; margin-bottom:4px;">${sec.icon} ${title}</div>${bullets}</div>`);
    }
    return parts.join("");
  };

  const formatAnalysisText = (text: string): string => {
    if (!text) return "";
    const trimmed = text.trim();
    if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
      try {
        const obj = JSON.parse(trimmed.replace(/^```json\s*|\s*```$/g, ""));
        if (obj && typeof obj === "object" && !Array.isArray(obj)) {
          const rendered = renderStructuredAnalysis(obj);
          if (rendered) return rendered;
        }
      } catch {
        // fall through to plain-text rendering
      }
    }
    return text
      .split("\n")
      .map((line) => {
        if (!line.trim()) return "";
        line = highlightNumbers(line);
        if (line.includes("Past-performance takeaway") || line.includes("历史表现结论")) {
          return `<div style="font-weight:600; color:#1e40af; margin-bottom:8px;">📈 ${line}</div>`;
        }
        if (line.startsWith("- ") || line.startsWith("• ")) {
          return `<div style="margin-left:12px; margin-top:4px; color:#374151;">• ${line.replace(/^[-•]\s*/, "")}</div>`;
        }
        if (line.includes("Verdict") || line.includes("结论")) {
          return `<div style="margin-top:8px; font-weight:600; color:${verdictColor};">${line}</div>`;
        }
        return `<div style="margin-top:4px; color:#374151;">${line}</div>`;
      })
      .join("");
  };

  const pt = {
    title: isZh ? "财务业绩" : "Financial Performance",
    perfAnalysis: isZh ? "业绩分析" : "Performance Analysis",
    valuationVerdict: isZh ? "估值判断" : "Valuation Verdict",
    marketCap: isZh ? "市值" : "Market Cap",
    latestQuarterComp: isZh ? "最新季度对比" : "Latest Quarter Comparison",
    metric: isZh ? "指标" : "Metric",
    mcRevenue: isZh ? "市值/营收" : "MC / Revenue",
    mcNetIncome: isZh ? "市值/净利润" : "MC / Net Income",
    quarterTrend: isZh ? "5季度趋势" : "5 Quarter Trend",
  };

  let html = `<strong>📊 ${pt.title} - ${tickerData["Company Name"] || ticker} (${ticker})</strong><br><br>
  <div style="background:white; border-radius:12px; box-shadow:0 2px 8px rgba(0,0,0,0.1); overflow:hidden;">

    <div style="background:linear-gradient(135deg,#1e40af 0%,#3b82f6 100%); padding:16px 20px; color:white;">
      <div style="display:flex; justify-content:space-between; align-items:center;">
        <div>
          <div style="font-size:12px; opacity:0.8;">${pt.perfAnalysis} · ${period}</div>
          <div style="font-size:20px; font-weight:bold; margin-top:4px;">${tickerData["Company Name"] || ticker}</div>
          ${peers.length > 0 ? `<div style="font-size:11px; opacity:0.7; margin-top:4px;">vs ${peers.join(" · ")}</div>` : ""}
        </div>
        <div style="text-align:right;">
          <div style="font-size:12px; opacity:0.8;">${pt.valuationVerdict}</div>
          <div style="font-size:18px; font-weight:bold; margin-top:4px; background:${verdictColor}; padding:4px 12px; border-radius:8px;">
            ${verdictIcon} ${verdictText}
          </div>
        </div>
      </div>
    </div>

    <div style="padding:16px;">

      <div style="display:grid; grid-template-columns:repeat(4,1fr); gap:8px; margin-bottom:16px;">
        <div style="padding:10px; background:#f9fafb; border-radius:8px; text-align:center;">
          <div style="font-size:11px; color:#6b7280;">${pt.marketCap}</div>
          <div style="font-size:14px; font-weight:600; color:#1f2937;">${fmtVal(tickerData["Market Cap"]?.["Current"], "Market Cap")}</div>
        </div>
        <div style="padding:10px; background:#f9fafb; border-radius:8px; text-align:center;">
          <div style="font-size:11px; color:#6b7280;">${isZh ? "市盈率 (TTM)" : "P/E Ratio (TTM)"}</div>
          <div style="font-size:14px; font-weight:600; color:#1f2937;">${fmtPE(tickerData["P/E Ratio"])}</div>
        </div>
        <div style="padding:10px; background:#f9fafb; border-radius:8px; text-align:center;">
          <div style="font-size:11px; color:#6b7280;">${isZh ? "远期市盈率" : "Forward P/E"}</div>
          <div style="font-size:14px; font-weight:600; color:#1f2937;">${fmtPE(tickerData["Forward P/E"])}</div>
        </div>
        <div style="padding:10px; background:#f9fafb; border-radius:8px; text-align:center;">
          <div style="font-size:11px; color:#6b7280;">${isZh ? "每股收益" : "EPS"}</div>
          <div style="font-size:14px; font-weight:600; color:#1f2937;">${tickerData["EPS"] ? "$" + Number(tickerData["EPS"]).toFixed(2) : "N/A"}</div>
        </div>
      </div>

      ${analysisText ? `
      <!-- AI 分析文本 -->
      <div style="padding:14px; background:#f0f9ff; border-left:3px solid #3b82f6; border-radius:6px; margin-bottom:16px; font-size:13px; line-height:1.7;">
        <div style="font-weight:600; color:#1e40af; margin-bottom:8px;">${isZh ? "主公司分析" : "Primary Company Analysis"}</div>
        ${formatAnalysisText(analysisText)}
      </div>` : ""}
      ${renderTrendChart(allTickers, metrics, isZh)}`;

  // ===== 同行对比表格（有 peers 时显示）=====
  if (peers.length > 0) {
    const comparisonMetrics = [
      "Market Cap", "Total Revenue", "Gross Margin %", "Operating Expense",
      "EBIT", "Net Income", "Operating Cash Flow", "Free Cash Flow",
      "P/E Ratio", "Price/Sales",
    ];

    // Each ticker shows its own latest reported quarter — no apples-to-apples
    // alignment. Display whatever valuation returned for each ticker directly.
    const getLatestQuarterForTicker = (t: string): string | undefined => {
      const rev = metrics?.[t]?.["Total Revenue"];
      if (!rev || typeof rev !== "object") return undefined;
      const qs = Object.keys(rev).filter(k => k !== "Current").sort();
      return qs[qs.length - 1];
    };

    const tickerQuarters: Record<string, string | undefined> = {};
    for (const t of allTickers) tickerQuarters[t] = getLatestQuarterForTicker(t);

    html += `
      <!-- 同行对比表格 -->
      <div style="margin-bottom:16px;">
        <div style="font-weight:600; color:#374151; margin-bottom:8px;">📊 ${pt.latestQuarterComp}</div>
        <div style="overflow-x:auto;">
          <table style="width:100%; border-collapse:collapse; font-size:12px; background:white; border-radius:8px; overflow:hidden; box-shadow:0 1px 3px rgba(0,0,0,0.1);">
            <thead>
              <tr style="background:#f8fafc; border-bottom:2px solid #e2e8f0;">
                <th style="padding:10px 12px; text-align:left; color:#475569;">${pt.metric}</th>
                ${allTickers.map((t, i) => {
                  const q = tickerQuarters[t] || "";
                  return `<th style="padding:10px 12px; text-align:right; color:${i === 0 ? "#4f46e5" : "#475569"};">
                    ${t}<br><span style="font-size:10px; color:#94a3b8;">${q}</span>
                  </th>`;
                }).join("")}
              </tr>
            </thead>
            <tbody>
              ${comparisonMetrics.map((metric, idx) => {
                const bg = idx % 2 === 0 ? "#ffffff" : "#f9fafb";
                return `
                <tr style="background:${bg}; border-bottom:1px solid #e5e7eb;">
                  <td style="padding:8px 12px; font-weight:500; color:#374151;">${localizeMetricName(metric, language)}</td>
                  ${allTickers.map((t, i) => {
                    const q = tickerQuarters[t];
                    const val = metric === "Market Cap"
                      ? metrics[t]?.["Market Cap"]?.["Current"]
                      : (q ? metrics[t]?.[metric]?.[q] : undefined);
                    return `<td style="padding:8px 12px; text-align:right; font-weight:${i === 0 ? "600" : "400"}; color:${i === 0 ? "#4f46e5" : "#64748b"};">${fmtVal(val, metric)}</td>`;
                  }).join("")}
                </tr>`;
              }).join("")}
            </tbody>
          </table>
        </div>
      </div>`;
  }

  // ===== 5季度时间序列表格 (每个 ticker 一张) =====
  const tsMetrics = [
    "Total Revenue", "Operating Expense", "EBIT", "Net Income",
    "Operating Cash Flow", "Free Cash Flow", "P/E Ratio", "Price/Sales",
  ];
  // Mirrors PeerComparison/app.py:2409 — only these four are summed for TTM.
  // OCF / FCF are intentionally left as "—" to match the reference UI.
  const ttmSummableMetrics = new Set([
    "Total Revenue", "Operating Expense", "EBIT", "Net Income",
  ]);
  const ratioMetrics = new Set(["P/E Ratio", "Price/Sales"]);
  const ttmCellStyle = "color:#1d4ed8; background:#eff6ff;";

  for (const t of allTickers) {
    const tData = metrics?.[t];
    if (!tData || tData.error) continue;
    const tRev = tData["Total Revenue"];
    if (!tRev || typeof tRev !== "object") continue;
    const tQuarters = Object.keys(tRev).filter(q => q !== "Current").sort().reverse().slice(0, 5);
    if (tQuarters.length === 0) continue;

    const ttmQs = tQuarters.slice(0, 4);
    const hasTTM = ttmQs.length === 4;
    const latestQ = tQuarters[0];

    const ttmDisplay = (metric: string): string => {
      if (ttmSummableMetrics.has(metric) && hasTTM) {
        const vals = ttmQs
          .map(q => tData[metric]?.[q])
          .filter((v: any) => v !== undefined && v !== null);
        if (vals.length === 0) return "—";
        const sum = vals.reduce((a: number, b: any) => a + Number(b), 0);
        const partial = vals.length < 4 ? "*" : "";
        return fmtVal(sum, metric) + partial;
      }
      if (ratioMetrics.has(metric)) {
        const v = tData[metric]?.[latestQ];
        if (v === undefined || v === null) return "—";
        return Number(v).toFixed(2) + "x";
      }
      return "—";
    };

    html += `
      <!-- 5季度时间序列 -->
      <div style="margin-bottom:16px;">
        <div style="font-weight:600; color:#374151; margin-bottom:8px;">📈 ${t} - ${pt.quarterTrend}</div>
        <div style="overflow-x:auto;">
          <table style="width:100%; border-collapse:collapse; font-size:12px; background:white; border-radius:8px; overflow:hidden; box-shadow:0 1px 3px rgba(0,0,0,0.1);">
            <thead>
              <tr style="background:#f8fafc; border-bottom:2px solid #e2e8f0;">
                <th style="padding:10px 12px; text-align:left; color:#475569;">${pt.metric}</th>
                <th style="padding:10px 12px; text-align:right; font-weight:700; ${ttmCellStyle}">TTM</th>
                ${tQuarters.map(q => `<th style="padding:10px 12px; text-align:right; color:#475569;">${q}</th>`).join("")}
              </tr>
            </thead>
            <tbody>
              ${tsMetrics.map((metric, idx) => {
                const bg = idx % 2 === 0 ? "#ffffff" : "#f9fafb";
                return `
                <tr style="background:${bg}; border-bottom:1px solid #e5e7eb;">
                  <td style="padding:8px 12px; font-weight:500; color:#374151;">${localizeMetricName(metric, language)}</td>
                  <td style="padding:8px 12px; text-align:right; font-weight:600; ${ttmCellStyle}">${ttmDisplay(metric)}</td>
                  ${tQuarters.map(q => {
                    const val = tData[metric]?.[q];
                    return `<td style="padding:8px 12px; text-align:right; color:#1f2937;">${fmtVal(val, metric)}</td>`;
                  }).join("")}
                </tr>`;
              }).join("")}
            </tbody>
          </table>
        </div>
      </div>`;
  }

  html += `
    </div>

    <!-- 时间戳 -->
    <div style="padding:8px 16px; background:#f9fafb; font-size:11px; color:#9ca3af; text-align:right;">
      ${analysis?.timestamp ? new Date(analysis.timestamp).toLocaleString(getLocale(language)) : new Date().toLocaleString(getLocale(language))}
    </div>
  </div>`;

  return html;
}
