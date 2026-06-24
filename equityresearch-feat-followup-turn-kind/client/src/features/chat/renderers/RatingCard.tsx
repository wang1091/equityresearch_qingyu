import type { RatingResponse, RatingTechnicalSignal } from "@shared/rating";
import type { UILanguage } from "@/utils/i18n";

/**
 * Frontend renderer for the analyst-RATING card — the structured replacement for
 * server/agent/formatters/rating.ts. Consumes the shared RatingResponse contract;
 * labels are bilingual, numbers formatted client-side. First consumer of the
 * generic source_card channel (see docs/CARD_RENDER_MIGRATION_PLAN.md).
 */
export const RatingCard = ({ payload, uiLanguage }: { payload: RatingResponse; uiLanguage: UILanguage }) => {
  const isZh = uiLanguage === "zh";
  const d = payload;
  const technical = d.technical ?? ({} as RatingResponse["technical"]);
  const levels = d.levels ?? ({} as RatingResponse["levels"]);
  const valuation = d.valuation ?? ({} as RatingResponse["valuation"]);
  const scores = d.scores ?? {};
  const bullish = d.bullish ?? [];
  const bearish = d.bearish ?? [];
  const reports = d.reports ?? [];
  const latestNews = d.news?.headline ?? null;

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
    bullish: isZh ? "看多" : "Bullish",
    bearish: isZh ? "看空" : "Bearish",
    latestReports: isZh ? "最新研报" : "Latest Reports",
    latest: isZh ? "最新" : "Latest",
  };
  const scoreLabels: Record<string, string> = {
    innovativeness: isZh ? "创新能力" : "Innovativeness",
    hiring: isZh ? "招聘" : "Hiring",
    sustainability: isZh ? "可持续发展" : "Sustainability",
    insiderSentiments: isZh ? "内部人情绪" : "Insider Sentiments",
    earningsReports: isZh ? "财报表现" : "Earnings Reports",
    dividends: isZh ? "分红" : "Dividends",
  };

  const ratingColor = (() => {
    const r = (d.rating || "").toLowerCase();
    if (r.includes("buy") || r.includes("bullish") || r.includes("买入") || r.includes("看多")) return "bg-emerald-500";
    if (r.includes("sell") || r.includes("bearish") || r.includes("卖出") || r.includes("看空")) return "bg-red-500";
    return "bg-amber-500";
  })();

  const dirIcon = (dir: string | null) => {
    if (!dir) return "—";
    const n = dir.toLowerCase();
    if (n === "bullish" || n.includes("看多")) return "🟢";
    if (n === "bearish" || n.includes("看空")) return "🔴";
    return "🟡";
  };
  const dirLabel = (dir: string | null) => {
    if (!dir) return "—";
    const n = dir.toLowerCase();
    if (n === "bullish") return isZh ? "看多" : "Bullish";
    if (n === "bearish") return isZh ? "看空" : "Bearish";
    if (n === "neutral") return isZh ? "中性" : "Neutral";
    return dir;
  };
  const money = (v: number | null | undefined) => (typeof v === "number" ? `$${v.toFixed(2)}` : "—");

  const TechCell = ({ label, sig }: { label: string; sig?: RatingTechnicalSignal }) => (
    <div className="rounded-lg bg-gray-50 p-2.5 text-center">
      <div className="text-[11px] text-gray-500">{label}</div>
      <div className="mt-1 text-lg leading-none">{dirIcon(sig?.direction ?? null)}</div>
      <div className="text-xs font-semibold text-gray-700">{dirLabel(sig?.direction ?? null)}</div>
      {sig?.desc && <div className="mt-0.5 text-[10px] text-gray-400">{sig.desc}</div>}
    </div>
  );

  const ScoreBar = ({ label, value }: { label: string; value: number | null | undefined }) => {
    if (value === null || value === undefined) return null;
    const pct = Math.round(value * 100);
    const color = value > 0.7 ? "bg-emerald-500" : value > 0.4 ? "bg-amber-500" : "bg-red-500";
    return (
      <div className="mb-2">
        <div className="mb-0.5 flex justify-between text-xs text-gray-700">
          <span>{label}</span>
          <span className="font-semibold">{pct}%</span>
        </div>
        <div className="h-1.5 rounded bg-gray-200">
          <div className={`h-1.5 rounded ${color}`} style={{ width: `${pct}%` }} />
        </div>
      </div>
    );
  };

  return (
    <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
      {/* Header */}
      <div className="bg-gradient-to-r from-blue-800 to-blue-500 px-5 py-4 text-white">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-xs opacity-80">⭐ {t.title} · {d.ticker}</div>
            <div className="mt-1 text-xs opacity-80">{t.consensus}</div>
            <div className="mt-1">
              <span className={`rounded-lg px-3 py-1 text-lg font-bold ${ratingColor}`}>{d.rating || "N/A"}</span>
            </div>
            {d.provider && <div className="mt-1.5 text-[11px] opacity-70">{t.by} {d.provider}</div>}
          </div>
          <div className="text-right">
            <div className="text-xs opacity-80">{t.currentPrice}</div>
            <div className="mt-1 text-2xl font-bold">{money(d.price)}</div>
            <div className="mt-1 text-xs opacity-70">{t.target}: {money(d.target)}</div>
          </div>
        </div>
      </div>

      <div className="space-y-4 p-4">
        {/* Technical */}
        <div>
          <div className="mb-2 font-semibold text-gray-700">📊 {t.techOutlook}</div>
          <div className="grid grid-cols-3 gap-2">
            <TechCell label={t.shortTerm} sig={technical.short} />
            <TechCell label={t.midTerm} sig={technical.mid} />
            <TechCell label={t.longTerm} sig={technical.long} />
          </div>
          {(technical.vsSector || technical.vsIndex) && (
            <div className="mt-2 flex gap-2">
              {technical.vsSector && (
                <div className="flex-1 rounded-md bg-gray-100 px-2.5 py-1.5 text-center text-xs">
                  <span className="text-gray-500">{t.vsSector}</span>
                  <span className="ml-1 font-semibold">{dirIcon(technical.vsSector)} {dirLabel(technical.vsSector)}</span>
                </div>
              )}
              {technical.vsIndex && (
                <div className="flex-1 rounded-md bg-gray-100 px-2.5 py-1.5 text-center text-xs">
                  <span className="text-gray-500">{t.vsIndex}</span>
                  <span className="ml-1 font-semibold">{dirIcon(technical.vsIndex)} {dirLabel(technical.vsIndex)}</span>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Levels */}
        {(levels.support || levels.resistance || levels.stopLoss) && (
          <div className="grid grid-cols-3 gap-2">
            {levels.support != null && (
              <div className="rounded-lg bg-emerald-50 p-2.5 text-center">
                <div className="text-[11px] text-emerald-800">{t.support}</div>
                <div className="text-base font-bold text-emerald-600">{money(levels.support)}</div>
              </div>
            )}
            {levels.resistance != null && (
              <div className="rounded-lg bg-red-50 p-2.5 text-center">
                <div className="text-[11px] text-red-800">{t.resistance}</div>
                <div className="text-base font-bold text-red-500">{money(levels.resistance)}</div>
              </div>
            )}
            {levels.stopLoss != null && (
              <div className="rounded-lg bg-orange-50 p-2.5 text-center">
                <div className="text-[11px] text-orange-800">{t.stopLoss}</div>
                <div className="text-base font-bold text-orange-500">{money(levels.stopLoss)}</div>
              </div>
            )}
          </div>
        )}

        {/* Valuation */}
        {valuation.status && (
          <div className="rounded-md border-l-[3px] border-blue-500 bg-blue-50 px-3 py-2 text-sm">
            <span className="font-semibold text-blue-800">{t.valuation}:</span> {valuation.status}
            {valuation.discount ? ` (${valuation.discount})` : ""}
          </div>
        )}

        {/* Company scores */}
        {Object.values(scores).some((v) => v !== null && v !== undefined) && (
          <div>
            <div className="mb-2 font-semibold text-gray-700">🏢 {t.companyScores}</div>
            {Object.keys(scoreLabels).map((key) => (
              <ScoreBar key={key} label={scoreLabels[key]} value={scores[key]} />
            ))}
          </div>
        )}

        {/* Bullish / Bearish */}
        {(bullish.length > 0 || bearish.length > 0) && (
          <div className="grid grid-cols-2 gap-3">
            {bullish.length > 0 && (
              <div>
                <div className="mb-1.5 font-semibold text-emerald-600">🟢 {t.bullish}</div>
                {bullish.map((b, i) => (
                  <div key={i} className="border-b border-gray-100 py-1 text-xs text-gray-700">• {b}</div>
                ))}
              </div>
            )}
            {bearish.length > 0 && (
              <div>
                <div className="mb-1.5 font-semibold text-red-500">🔴 {t.bearish}</div>
                {bearish.map((b, i) => (
                  <div key={i} className="border-b border-gray-100 py-1 text-xs text-gray-700">• {b}</div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Reports */}
        {reports.length > 0 && (
          <div>
            <div className="mb-2 font-semibold text-gray-700">📄 {t.latestReports}</div>
            {reports.map((r, i) => (
              <div key={i} className="mb-1.5 rounded-md bg-gray-50 p-2">
                <div className="text-[13px] font-medium text-gray-900">{r.title || "N/A"}</div>
                <div className="mt-0.5 text-[11px] text-gray-500">
                  {[r.provider, r.date ? new Date(r.date).toLocaleDateString(isZh ? "zh-CN" : "en-US") : ""].filter(Boolean).join(" · ")}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Latest news */}
        {latestNews && (
          <div className="rounded-md border-l-[3px] border-blue-500 bg-sky-50 px-3 py-2 text-sm">
            <span className="font-semibold text-blue-800">📰 {t.latest}:</span> {latestNews}
          </div>
        )}
      </div>
    </div>
  );
};
