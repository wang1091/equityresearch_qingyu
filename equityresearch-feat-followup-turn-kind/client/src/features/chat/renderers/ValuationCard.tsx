import type { ValuationResponse } from "@shared/valuation";
import type { UILanguage } from "@/utils/i18n";

/**
 * Frontend renderer for the VALUATION card — structured replacement for
 * server/agent/formatters/valuation.ts. Consumes the shared ValuationResponse
 * contract directly (valuations.dcf / valuations.relative / ai_recommendation /
 * analyst). The old HTML formatter read an obsolete shape (data.details /
 * data.target_price / data.verdict) the backend no longer emits, so it rendered
 * N/A for everything but the current price — this card fixes that by reading the
 * real fields. Generic source_card channel (docs/CARD_RENDER_MIGRATION_PLAN.md).
 */
export const ValuationCard = ({
  payload,
  uiLanguage,
}: {
  payload: ValuationResponse;
  uiLanguage: UILanguage;
}) => {
  const isZh = uiLanguage === "zh";
  const d = payload;
  const rec = d.ai_recommendation ?? ({} as ValuationResponse["ai_recommendation"]);
  const dcf = d.valuations?.dcf ?? ({} as ValuationResponse["valuations"]["dcf"]);
  const rel = d.valuations?.relative ?? ({} as ValuationResponse["valuations"]["relative"]);
  const analyst = d.analyst;
  const current = d.current_price ?? 0;

  const t = {
    summary: isZh ? "估值摘要" : "Valuation Summary for",
    modelComparison: isZh ? "模型估值对比" : "Model Estimates Comparison",
    dcfModel: isZh ? "DCF 模型" : "DCF Model",
    relativeModel: isZh ? "相对估值" : "Relative Valuation",
    range: isZh ? "区间" : "Range",
    peers: isZh ? "可比公司" : "Peers",
    currentPrice: isZh ? "当前价格" : "Current Price",
    marketPrice: isZh ? "市场价格" : "Market Price",
    selectedMethod: isZh ? "选用方法" : "Selected Method",
    targetPrice: isZh ? "目标价格" : "Target Price",
    confidence: isZh ? "置信度" : "Confidence",
    rationale: isZh ? "分析依据" : "Rationale",
    assumptions: isZh ? "DCF 假设参数" : "DCF Assumptions",
    analystConsensus: isZh ? "分析师共识" : "Analyst Consensus",
    targetMean: isZh ? "平均目标价" : "Mean Target",
    buy: isZh ? "买入" : "Buy",
    hold: isZh ? "持有" : "Hold",
    sell: isZh ? "卖出" : "Sell",
  };

  const money = (v: number | null | undefined) => (typeof v === "number" && v !== 0 ? `$${v.toFixed(2)}` : "N/A");
  // Upside vs the current market price; returns null when not computable.
  const upsideOf = (target: number | null | undefined) =>
    typeof target === "number" && target > 0 && current > 0 ? ((target - current) / current) * 100 : null;

  const decisionLabel = (() => {
    const raw = rec.decision || "";
    if (!isZh) return raw;
    const u = raw.toUpperCase();
    if (u === "OVERVALUED") return "高估";
    if (u === "UNDERVALUED") return "低估";
    return raw; // fair-value band label — leave as backend emitted
  })();
  const decisionColor = (() => {
    const u = (rec.decision || "").toUpperCase();
    if (u === "OVERVALUED") return "bg-red-100 text-red-800 border-red-300";
    if (u === "UNDERVALUED") return "bg-emerald-100 text-emerald-800 border-emerald-300";
    return "bg-amber-100 text-amber-800 border-amber-300";
  })();

  const methodLabel = (() => {
    const m = rec.chosen_method || "";
    if (m === "DCF") return t.dcfModel;
    if (m.startsWith("Relative")) return t.relativeModel;
    return m || "N/A";
  })();

  const Upside = ({ pct }: { pct: number | null }) => {
    if (pct === null) return null;
    const positive = pct > 0;
    return (
      <div className={`mt-0.5 text-xs font-semibold ${positive ? "text-emerald-600" : "text-red-500"}`}>
        {positive ? "+" : ""}
        {pct.toFixed(1)}% {positive ? "↑" : "↓"}
      </div>
    );
  };

  // DCF assumption rows. Growth/margin/rate fields arrive already in percent
  // (>1) from newer backends but as fractions (≤1) from the fallback — mirror the
  // old formatter's normalize. Beta is a plain number.
  const a = dcf.assumptions ?? {};
  const fmtPct = (v: number | undefined) =>
    v != null && v !== 0 ? `${(v * (v > 1 ? 1 : 100)).toFixed(1)}%` : null;
  const fmtNum = (v: number | undefined) => (v != null && v !== 0 ? v.toFixed(2) : null);
  const assumptionItems: [string, string][] = (
    [
      ["Beta", fmtNum(a.beta)],
      [isZh ? "营收增长" : "Rev Growth", fmtPct(a.revenue_growth)],
      [isZh ? "毛利率" : "Gross Margin", fmtPct(a.gross_margin)],
      [isZh ? "税率" : "Tax Rate", fmtPct(a.tax_rate)],
      [isZh ? "终值增长" : "Terminal Growth", fmtPct(a.terminal_growth)],
      [isZh ? "预测年数" : "Proj. Years", a.projection_years ? String(a.projection_years) : null],
    ] as [string, string | null][]
  ).filter((x): x is [string, string] => x[1] !== null);

  return (
    <div className="overflow-hidden rounded-xl bg-white shadow-sm">
      {/* Header */}
      <div className="bg-gradient-to-br from-indigo-500 to-purple-600 px-4 py-3.5 text-white">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex min-w-0 flex-1 items-center gap-1.5 truncate text-[15px] font-bold">
            💰 <span className="truncate">{t.summary} {d.ticker}</span>
          </div>
          {rec.decision && (
            <span className={`flex-shrink-0 whitespace-nowrap rounded-full border px-3 py-1 text-[11px] font-bold ${decisionColor}`}>
              {decisionLabel}
            </span>
          )}
        </div>
      </div>

      {/* Model estimates */}
      <div className="border-b border-gray-200 px-4 py-3.5">
        <SectionLabel>{t.modelComparison}</SectionLabel>
        <div className="grid grid-cols-3 gap-3">
          <div className="min-w-0 border-l-[3px] border-blue-500 pl-2.5">
            <div className="mb-0.5 truncate text-[10px] text-gray-500">📊 {t.dcfModel}</div>
            <div className="text-xl font-extrabold leading-tight text-gray-800">{money(dcf.target_price)}</div>
            <Upside pct={upsideOf(dcf.target_price)} />
          </div>
          <div className="min-w-0 border-l-[3px] border-violet-500 pl-2.5">
            <div className="mb-0.5 truncate text-[10px] text-gray-500">📈 {t.relativeModel}</div>
            <div className="text-xl font-extrabold leading-tight text-gray-800">{money(rel.median_estimate)}</div>
            <Upside pct={upsideOf(rel.median_estimate)} />
            {rel.low_estimate > 0 && rel.high_estimate > 0 && (
              <div className="mt-0.5 truncate text-[10px] text-gray-400">
                {t.range}: ${rel.low_estimate.toFixed(0)}–${rel.high_estimate.toFixed(0)}
              </div>
            )}
            {rel.peers?.length > 0 && (
              <div className="mt-0.5 truncate text-[10px] text-gray-400">
                {t.peers}: {rel.peers.join(", ")}
              </div>
            )}
          </div>
          <div className="min-w-0 border-l-[3px] border-emerald-500 pl-2.5">
            <div className="mb-0.5 truncate text-[10px] text-gray-500">💵 {t.currentPrice}</div>
            <div className="text-xl font-extrabold leading-tight text-gray-800">{money(current)}</div>
            <div className="mt-0.5 text-[10px] text-gray-400">{t.marketPrice}</div>
          </div>
        </div>
      </div>

      {/* Target price summary */}
      <div className="px-4 py-3.5">
        <div className="rounded-[10px] border-[1.5px] border-amber-500 bg-gradient-to-br from-amber-50 to-amber-100 p-3.5">
          <div className="grid grid-cols-3 gap-2 text-center">
            <div className="min-w-0">
              <SummaryLabel>{t.selectedMethod}</SummaryLabel>
              <div className="truncate text-[13px] font-bold leading-tight text-amber-950">{methodLabel}</div>
            </div>
            <div className="min-w-0 border-x border-amber-300">
              <SummaryLabel>{t.targetPrice}</SummaryLabel>
              <div className="text-[22px] font-extrabold leading-tight text-amber-950">{money(rec.chosen_price)}</div>
              <Upside pct={upsideOf(rec.chosen_price)} />
            </div>
            <div className="min-w-0">
              <SummaryLabel>{t.confidence}</SummaryLabel>
              <div className="text-[22px] font-extrabold leading-tight text-amber-950">
                {typeof rec.confidence === "number" ? `${(rec.confidence * 100).toFixed(0)}%` : "N/A"}
              </div>
            </div>
          </div>
        </div>

        {rec.rationale && (
          <div className="mt-3 rounded-lg border-l-[3px] border-gray-300 bg-gray-50 px-3 py-2.5">
            <SectionLabel>{t.rationale}</SectionLabel>
            <div className="text-xs leading-relaxed text-gray-600">{rec.rationale}</div>
          </div>
        )}

        {assumptionItems.length > 0 && (
          <div className="mt-2.5 rounded-lg border-l-[3px] border-sky-400 bg-sky-50 px-3 py-2.5">
            <div className="mb-2 text-[10px] font-bold uppercase tracking-wider text-sky-700">{t.assumptions}</div>
            <div className="grid grid-cols-4 gap-1.5">
              {assumptionItems.map(([label, val]) => (
                <div key={label} className="min-w-0">
                  <div className="mb-0.5 truncate text-[9px] text-slate-500">{label}</div>
                  <div className="text-xs font-bold text-sky-900">{val}</div>
                </div>
              ))}
            </div>
          </div>
        )}

        {analyst && analyst.number_of_analyst_opinions != null && (
          <div className="mt-2.5 rounded-lg border-l-[3px] border-indigo-400 bg-indigo-50 px-3 py-2.5">
            <div className="mb-2 flex items-baseline justify-between">
              <span className="text-[10px] font-bold uppercase tracking-wider text-indigo-700">{t.analystConsensus}</span>
              {analyst.target_mean_price != null && (
                <span className="text-xs text-indigo-900">
                  {t.targetMean}: <span className="font-bold">{money(analyst.target_mean_price)}</span>
                </span>
              )}
            </div>
            <div className="flex gap-2 text-center text-[11px]">
              <div className="flex-1 rounded bg-emerald-100 py-1 font-semibold text-emerald-800">{t.buy} {analyst.buy_count}</div>
              <div className="flex-1 rounded bg-amber-100 py-1 font-semibold text-amber-800">{t.hold} {analyst.hold_count}</div>
              <div className="flex-1 rounded bg-red-100 py-1 font-semibold text-red-800">{t.sell} {analyst.sell_count}</div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

const SectionLabel = ({ children }: { children: React.ReactNode }) => (
  <div className="mb-2.5 text-[10px] font-semibold uppercase tracking-wider text-gray-500">{children}</div>
);

const SummaryLabel = ({ children }: { children: React.ReactNode }) => (
  <div className="mb-1 text-[9px] font-semibold uppercase tracking-wider text-amber-800">{children}</div>
);
