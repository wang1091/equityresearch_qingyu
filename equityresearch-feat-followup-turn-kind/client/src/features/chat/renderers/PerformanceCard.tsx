import type { PerformanceResponse, PerformanceStructuredAnalysis } from "@shared/performance";
import type { UILanguage } from "@/utils/i18n";

/**
 * Frontend renderer for the PERFORMANCE card — structured replacement for
 * server/agent/formatters/performance.ts. Consumes the shared PerformanceResponse
 * ({ analysis?, primaryTicker, peers, metrics, peerConclusion? }); numbers are
 * formatted and labels localized client-side. Generic source_card channel
 * (docs/CARD_RENDER_MIGRATION_PLAN.md).
 *
 * `metrics` cells are loosely typed upstream (a series object, or a bare string
 * for "Company Name", or a number for "EPS"), so we read it through `Metrics`.
 */
type Metrics = Record<string, Record<string, any>>;

const COLORS = ["#6366f1", "#10b981", "#f59e0b", "#f97316", "#ef4444"];

const localizeMetricName = (metric: string, isZh: boolean): string => {
  if (metric === "P/E Ratio") return isZh ? "市盈率 (TTM)" : "P/E Ratio (TTM)";
  if (metric === "Price/Sales") return isZh ? "市销率 (TTM)" : "Price/Sales (TTM)";
  if (!isZh) return metric;
  const map: Record<string, string> = {
    "Total Revenue": "总营收",
    "Gross Margin %": "毛利率",
    "Operating Expense": "运营费用",
    EBIT: "息税前利润",
    "Net Income": "净利润",
    "Free Cash Flow": "自由现金流",
    "Market Cap": "市值",
  };
  return map[metric] || metric;
};

const fmtVal = (value: number | null | undefined, metric: string): string => {
  if (value === undefined || value === null) return "—";
  if (metric === "Gross Margin %") return Number(value).toFixed(1) + "%";
  if (metric === "P/E Ratio" || metric === "Price/Sales") return Number(value).toFixed(2) + "x";
  const abs = Math.abs(value);
  const sign = value < 0 ? "-" : "";
  if (abs >= 1e9) return `${sign}$${(abs / 1e9).toFixed(1)}B`;
  if (abs >= 1e6) return `${sign}$${(abs / 1e6).toFixed(0)}M`;
  if (abs >= 1e3) return `${sign}$${(abs / 1e3).toFixed(0)}K`;
  return `${sign}$${abs.toFixed(0)}`;
};

const fmtPE = (v: any): string => {
  let num: number | undefined;
  if (typeof v === "number") num = v;
  else if (v && typeof v === "object") {
    const vals = Object.values(v) as number[];
    num = vals[vals.length - 1];
  }
  if (!num || isNaN(num)) return "N/A";
  return Number(num).toFixed(1) + "x";
};

const parseStructured = (text: string): PerformanceStructuredAnalysis | null => {
  const trimmed = (text || "").trim().replace(/^```json\s*|\s*```$/g, "");
  if (!trimmed.startsWith("{") || !trimmed.endsWith("}")) return null;
  try {
    const obj = JSON.parse(trimmed);
    return obj && typeof obj === "object" && !Array.isArray(obj) ? obj : null;
  } catch {
    return null;
  }
};

export const PerformanceCard = ({
  payload,
  uiLanguage,
}: {
  payload: PerformanceResponse;
  uiLanguage: UILanguage;
}) => {
  const isZh = uiLanguage === "zh";
  const d = payload;
  const metrics = (d.metrics ?? {}) as Metrics;
  const analysis = d.analysis;

  const ticker =
    analysis?.ticker || d.primaryTicker || Object.keys(metrics).find((k) => k !== "N/A") || "N/A";
  const peers: string[] = analysis?.peers || d.peers || [];
  const period = analysis?.period || "Latest";
  const allTickers = [ticker, ...peers];
  const tickerData = metrics[ticker];

  const conclusionText = isZh
    ? d.peerConclusion?.zh || d.peerConclusion?.en || ""
    : d.peerConclusion?.en || "";
  const analysisText = analysis?.analysis || conclusionText || "";
  const structured = parseStructured(analysisText);

  const parsedRating = structured && typeof structured.rating === "string" ? structured.rating.trim() : null;
  const ratingLc = parsedRating ? parsedRating.toLowerCase() : "";
  const isOvervalued = parsedRating ? ratingLc === "overvalued" || parsedRating === "高估" : /Overvalued|高估/i.test(analysisText);
  const isUndervalued = parsedRating ? ratingLc === "undervalued" || parsedRating === "低估" : /Undervalued|低估/i.test(analysisText);
  const verdict = {
    color: isOvervalued ? "bg-red-500" : isUndervalued ? "bg-emerald-500" : "bg-amber-500",
    icon: isOvervalued ? "⚠️" : isUndervalued ? "✅" : "➡️",
    text: isOvervalued ? (isZh ? "高估" : "Overvalued") : isUndervalued ? (isZh ? "低估" : "Undervalued") : isZh ? "合理" : "Fairly Valued",
  };

  const t = {
    title: isZh ? "财务业绩" : "Financial Performance",
    perfAnalysis: isZh ? "业绩分析" : "Performance Analysis",
    valuationVerdict: isZh ? "估值判断" : "Valuation Verdict",
    marketCap: isZh ? "市值" : "Market Cap",
    latestQuarterComp: isZh ? "最新季度对比" : "Latest Quarter Comparison",
    metric: isZh ? "指标" : "Metric",
    quarterTrend: isZh ? "5季度趋势" : "5 Quarter Trend",
    primaryAnalysis: isZh ? "主公司分析" : "Primary Company Analysis",
    noMetrics: isZh ? "暂无指标数据" : "No metrics data",
  };

  const companyName = (tickerData?.["Company Name"] as string) || ticker;

  if (!tickerData) {
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
        📊 {t.title} · {t.noMetrics}
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-xl bg-white shadow-sm">
      {/* Header */}
      <div className="bg-gradient-to-br from-blue-800 to-blue-500 px-5 py-4 text-white">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="text-xs opacity-80">{t.perfAnalysis} · {period}</div>
            <div className="mt-1 truncate text-xl font-bold">{companyName} <span className="text-sm font-normal opacity-80">({ticker})</span></div>
            {peers.length > 0 && <div className="mt-1 truncate text-[11px] opacity-70">vs {peers.join(" · ")}</div>}
          </div>
          <div className="flex-shrink-0 text-right">
            <div className="text-xs opacity-80">{t.valuationVerdict}</div>
            <div className={`mt-1 rounded-lg px-3 py-1 text-base font-bold ${verdict.color}`}>{verdict.icon} {verdict.text}</div>
          </div>
        </div>
      </div>

      <div className="p-4">
        {/* Key metrics grid */}
        <div className="mb-4 grid grid-cols-4 gap-2">
          <MetricBox label={t.marketCap} value={fmtVal(tickerData["Market Cap"]?.["Current"], "Market Cap")} />
          <MetricBox label={isZh ? "市盈率 (TTM)" : "P/E Ratio (TTM)"} value={fmtPE(tickerData["P/E Ratio"])} />
          <MetricBox label={isZh ? "远期市盈率" : "Forward P/E"} value={fmtPE(tickerData["Forward P/E"])} />
          <MetricBox label={isZh ? "每股收益" : "EPS"} value={tickerData["EPS"] ? "$" + Number(tickerData["EPS"]).toFixed(2) : "N/A"} />
        </div>

        {/* AI analysis */}
        {analysisText && (
          <div className="mb-4 rounded-md border-l-[3px] border-blue-500 bg-sky-50 px-3.5 py-3 text-[13px] leading-relaxed">
            <div className="mb-2 font-semibold text-blue-800">{t.primaryAnalysis}</div>
            {structured ? <StructuredAnalysis obj={structured} isZh={isZh} /> : <PlainAnalysis text={analysisText} verdictColor={verdict.color} />}
          </div>
        )}

        {/* Trend chart */}
        <TrendChart allTickers={allTickers} metrics={metrics} isZh={isZh} />

        {/* Peer comparison table */}
        {peers.length > 0 && <PeerComparisonTable allTickers={allTickers} metrics={metrics} isZh={isZh} title={t.latestQuarterComp} metricLabel={t.metric} />}

        {/* Per-ticker 5-quarter trend tables */}
        {allTickers.map((tk) => (
          <QuarterTrendTable key={tk} ticker={tk} metrics={metrics} isZh={isZh} quarterTrendLabel={t.quarterTrend} metricLabel={t.metric} />
        ))}
      </div>

      {/* Timestamp */}
      <div className="bg-gray-50 px-4 py-2 text-right text-[11px] text-gray-400">
        {new Date(analysis?.timestamp || Date.now()).toLocaleString(isZh ? "zh-CN" : "en-US")}
      </div>
    </div>
  );
};

const MetricBox = ({ label, value }: { label: string; value: string }) => (
  <div className="rounded-lg bg-gray-50 p-2.5 text-center">
    <div className="text-[11px] text-gray-500">{label}</div>
    <div className="mt-0.5 text-sm font-semibold text-gray-800">{value}</div>
  </div>
);

const asBullets = (v: string[] | string | undefined): string[] =>
  Array.isArray(v) ? v.map(String) : typeof v === "string" && v.trim() ? [v] : [];

const StructuredAnalysis = ({ obj, isZh }: { obj: PerformanceStructuredAnalysis; isZh: boolean }) => {
  const sections: Array<{ key: keyof PerformanceStructuredAnalysis; titleEn: string; titleZh: string; icon: string }> = [
    { key: "summary", titleEn: "Summary", titleZh: "总结", icon: "📋" },
    { key: "financial_performance", titleEn: "Financial Performance", titleZh: "财务表现", icon: "💰" },
    { key: "peer_comparison_rank", titleEn: "Peer Comparison Rank", titleZh: "同业排名", icon: "🏆" },
    { key: "valuation_ratios", titleEn: "Valuation Ratios", titleZh: "估值比率", icon: "📊" },
  ];
  return (
    <>
      {sections.map((sec) => {
        const items = asBullets(obj[sec.key] as string[] | string | undefined);
        if (items.length === 0) return null;
        return (
          <div key={String(sec.key)} className="mt-2.5">
            <div className="mb-1 font-semibold text-blue-700">{sec.icon} {isZh ? sec.titleZh : sec.titleEn}</div>
            {items.map((item, i) => (
              <div key={i} className="ml-3 mt-1 text-gray-700">• {item}</div>
            ))}
          </div>
        );
      })}
    </>
  );
};

const PlainAnalysis = ({ text }: { text: string; verdictColor: string }) => (
  <div className="space-y-1 text-gray-700">
    {text.split("\n").filter((l) => l.trim()).map((line, i) => (
      <div key={i} className={line.startsWith("- ") || line.startsWith("• ") ? "ml-3" : ""}>
        {line.replace(/^[-•]\s*/, line.startsWith("- ") || line.startsWith("• ") ? "• " : "")}
      </div>
    ))}
  </div>
);

/** Grouped Total-Revenue bars + Gross-Margin% line over the 5 most-recent quarters. */
const TrendChart = ({ allTickers, metrics, isZh }: { allTickers: string[]; metrics: Metrics; isZh: boolean }) => {
  const quarterSet = new Set<string>();
  for (const tk of allTickers) {
    const rev = metrics?.[tk]?.["Total Revenue"];
    if (rev && typeof rev === "object") for (const q of Object.keys(rev)) if (q !== "Current") quarterSet.add(q);
  }
  const quarters = Array.from(quarterSet).sort().reverse().slice(0, 5).reverse();
  if (quarters.length === 0) return null;

  let maxRev = 0;
  for (const tk of allTickers) for (const q of quarters) {
    const v = metrics?.[tk]?.["Total Revenue"]?.[q];
    if (typeof v === "number" && v > maxRev) maxRev = v;
  }
  if (maxRev === 0) return null;

  const niceCeil = (n: number) => {
    const exp = Math.pow(10, Math.floor(Math.log10(n)));
    const m = n / exp;
    const nm = m > 5 ? 10 : m > 2 ? 5 : m > 1 ? 2 : 1;
    return nm * exp;
  };
  const yMax = niceCeil(maxRev);

  const W = 720, H = 280, ML = 64, MR = 50, MT = 32, MB = 40;
  const pw = W - ML - MR, ph = H - MT - MB;
  const groupW = pw / quarters.length;
  const barW = (groupW * 0.7) / allTickers.length;
  const groupPad = (groupW * 0.3) / 2;
  const fmtAxis = (v: number) => (v >= 1e9 ? `$${(v / 1e9).toFixed(0)}B` : v >= 1e6 ? `$${(v / 1e6).toFixed(0)}M` : `$${v}`);

  return (
    <div className="mb-4">
      <div className="mb-2 font-semibold text-gray-700">📈 {isZh ? "营收与毛利率趋势" : "Total Revenue & Gross Margin % Trend"}</div>
      <div className="overflow-x-auto rounded-lg bg-white p-2">
        <svg viewBox={`0 0 ${W} ${H}`} width="100%" preserveAspectRatio="xMidYMid meet">
          {/* gridlines + left (revenue) axis */}
          {[0, 1, 2, 3, 4, 5].map((i) => {
            const y = MT + ph - (i / 5) * ph;
            return (
              <g key={`g${i}`}>
                <line x1={ML} y1={y} x2={ML + pw} y2={y} stroke="#e5e7eb" strokeWidth={1} />
                <text x={ML - 8} y={y + 4} textAnchor="end" fontSize={10} fill="#6b7280">{fmtAxis((yMax / 5) * i)}</text>
                <text x={ML + pw + 8} y={y + 4} textAnchor="start" fontSize={10} fill="#6b7280">{20 * i}%</text>
              </g>
            );
          })}
          {/* revenue bars */}
          {quarters.map((q, qi) =>
            allTickers.map((tk, ti) => {
              const v = metrics?.[tk]?.["Total Revenue"]?.[q];
              if (typeof v !== "number") return null;
              const x = ML + qi * groupW + groupPad + ti * barW;
              const barH = (v / yMax) * ph;
              return <rect key={`${q}-${tk}`} x={x} y={MT + ph - barH} width={Math.max(barW - 2, 0)} height={barH} fill={COLORS[ti % COLORS.length]} opacity={0.85} />;
            }),
          )}
          {/* gross-margin line + points per ticker */}
          {allTickers.map((tk, ti) => {
            const pts: string[] = [];
            quarters.forEach((q, qi) => {
              const v = metrics?.[tk]?.["Gross Margin %"]?.[q];
              if (typeof v !== "number") return;
              pts.push(`${ML + qi * groupW + groupW / 2},${MT + ph - (v / 100) * ph}`);
            });
            return (
              <g key={`line-${tk}`}>
                {pts.length >= 2 && <polyline points={pts.join(" ")} fill="none" stroke={COLORS[ti % COLORS.length]} strokeWidth={2} />}
                {pts.map((p, i) => {
                  const [cx, cy] = p.split(",");
                  return <circle key={i} cx={cx} cy={cy} r={3} fill={COLORS[ti % COLORS.length]} />;
                })}
              </g>
            );
          })}
          {/* x labels */}
          {quarters.map((q, qi) => (
            <text key={`x${q}`} x={ML + qi * groupW + groupW / 2} y={MT + ph + 18} textAnchor="middle" fontSize={11} fill="#6b7280">{q}</text>
          ))}
          {/* legend */}
          {allTickers.map((tk, ti) => (
            <g key={`lg${tk}`}>
              <rect x={ML + ti * 90} y={6} width={10} height={10} fill={COLORS[ti % COLORS.length]} />
              <text x={ML + ti * 90 + 14} y={15} fontSize={11} fill="#374151">{tk}</text>
            </g>
          ))}
        </svg>
      </div>
    </div>
  );
};

const latestQuarterFor = (metrics: Metrics, tk: string): string | undefined => {
  const rev = metrics?.[tk]?.["Total Revenue"];
  if (!rev || typeof rev !== "object") return undefined;
  const qs = Object.keys(rev).filter((k) => k !== "Current").sort();
  return qs[qs.length - 1];
};

const PeerComparisonTable = ({ allTickers, metrics, isZh, title, metricLabel }: { allTickers: string[]; metrics: Metrics; isZh: boolean; title: string; metricLabel: string }) => {
  const rows = ["Market Cap", "Total Revenue", "Gross Margin %", "Operating Expense", "EBIT", "Net Income", "Operating Cash Flow", "Free Cash Flow", "P/E Ratio", "Price/Sales"];
  const tickerQ: Record<string, string | undefined> = {};
  for (const tk of allTickers) tickerQ[tk] = latestQuarterFor(metrics, tk);

  return (
    <div className="mb-4">
      <div className="mb-2 font-semibold text-gray-700">📊 {title}</div>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse overflow-hidden rounded-lg text-xs shadow-sm">
          <thead>
            <tr className="border-b-2 border-slate-200 bg-slate-50">
              <th className="px-3 py-2.5 text-left text-slate-600">{metricLabel}</th>
              {allTickers.map((tk, i) => (
                <th key={tk} className={`px-3 py-2.5 text-right ${i === 0 ? "text-indigo-600" : "text-slate-600"}`}>
                  {tk}<br /><span className="text-[10px] text-slate-400">{tickerQ[tk] || ""}</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((metric, idx) => (
              <tr key={metric} className={`border-b border-gray-200 ${idx % 2 ? "bg-gray-50" : "bg-white"}`}>
                <td className="px-3 py-2 font-medium text-gray-700">{localizeMetricName(metric, isZh)}</td>
                {allTickers.map((tk, i) => {
                  const q = tickerQ[tk];
                  const val = metric === "Market Cap" ? metrics[tk]?.["Market Cap"]?.["Current"] : q ? metrics[tk]?.[metric]?.[q] : undefined;
                  return <td key={tk} className={`px-3 py-2 text-right ${i === 0 ? "font-semibold text-indigo-600" : "text-slate-500"}`}>{fmtVal(val, metric)}</td>;
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

const QuarterTrendTable = ({ ticker, metrics, isZh, quarterTrendLabel, metricLabel }: { ticker: string; metrics: Metrics; isZh: boolean; quarterTrendLabel: string; metricLabel: string }) => {
  const tData = metrics?.[ticker];
  if (!tData || tData.error) return null;
  const rev = tData["Total Revenue"];
  if (!rev || typeof rev !== "object") return null;
  const quarters = Object.keys(rev).filter((q) => q !== "Current").sort().reverse().slice(0, 5);
  if (quarters.length === 0) return null;

  const rows = ["Total Revenue", "Operating Expense", "EBIT", "Net Income", "Operating Cash Flow", "Free Cash Flow", "P/E Ratio", "Price/Sales"];
  const ttmSummable = new Set(["Total Revenue", "Operating Expense", "EBIT", "Net Income"]);
  const ratio = new Set(["P/E Ratio", "Price/Sales"]);
  const ttmQs = quarters.slice(0, 4);
  const hasTTM = ttmQs.length === 4;
  const latestQ = quarters[0];

  const ttmDisplay = (metric: string): string => {
    if (ttmSummable.has(metric) && hasTTM) {
      const vals = ttmQs.map((q) => tData[metric]?.[q]).filter((v: any) => v !== undefined && v !== null);
      if (vals.length === 0) return "—";
      const sum = vals.reduce((a: number, b: any) => a + Number(b), 0);
      return fmtVal(sum, metric) + (vals.length < 4 ? "*" : "");
    }
    if (ratio.has(metric)) {
      const v = tData[metric]?.[latestQ];
      return v === undefined || v === null ? "—" : Number(v).toFixed(2) + "x";
    }
    return "—";
  };

  return (
    <div className="mb-4">
      <div className="mb-2 font-semibold text-gray-700">📈 {ticker} - {quarterTrendLabel}</div>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse overflow-hidden rounded-lg text-xs shadow-sm">
          <thead>
            <tr className="border-b-2 border-slate-200 bg-slate-50">
              <th className="px-3 py-2.5 text-left text-slate-600">{metricLabel}</th>
              <th className="bg-blue-50 px-3 py-2.5 text-right font-bold text-blue-700">TTM</th>
              {quarters.map((q) => (
                <th key={q} className="px-3 py-2.5 text-right text-slate-600">{q}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((metric, idx) => (
              <tr key={metric} className={`border-b border-gray-200 ${idx % 2 ? "bg-gray-50" : "bg-white"}`}>
                <td className="px-3 py-2 font-medium text-gray-700">{localizeMetricName(metric, isZh)}</td>
                <td className="bg-blue-50 px-3 py-2 text-right font-semibold text-blue-700">{ttmDisplay(metric)}</td>
                {quarters.map((q) => (
                  <td key={q} className="px-3 py-2 text-right text-gray-800">{fmtVal(tData[metric]?.[q], metric)}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};
