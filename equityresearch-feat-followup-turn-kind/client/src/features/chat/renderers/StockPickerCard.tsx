import type { StockPickerCardPayload } from "@shared/stockPicker";
import type { UILanguage } from "@/utils/i18n";
import { UI_TEXTS } from "@/utils/i18n";
import { MODULE_META } from "@/utils/constants";
import { CardShell, CardHeader, Section, Pill, ScoreBar, Bullets } from "./cardKit";

/**
 * Frontend renderer for the STOCK_PICKER card on the generic source_card channel.
 * Rebuilt as real JSX from the structured StockPickerCardPayload (per-engine scores
 * + breakdowns) — replacing the legacy renderStockPickerCard() HTML string — so it
 * matches the boxed-card style of the other source cards and composes the shared
 * cardKit primitives. Three modes: comparison (score-off), single (scorecard),
 * trending (category list). See docs/CARD_RENDER_MIGRATION_PLAN.md.
 */
type AnyResult = Record<string, any>;

const ENGINES = [
  { scoreKey: "financialScore", bdKey: "financialBreakdown", en: "Financial", zh: "财务", pos: "strengths", neg: "weaknesses" },
  { scoreKey: "sentimentScore", bdKey: "sentimentBreakdown", en: "Sentiment", zh: "情绪", pos: "key_drivers", neg: "risk_flags" },
  { scoreKey: "earningsScore", bdKey: "earningsBreakdown", en: "Earnings", zh: "财报", pos: "key_positives", neg: "key_risks" },
  { scoreKey: "valuationScore", bdKey: "valuationBreakdown", en: "Valuation", zh: "估值", pos: "key_assumptions", neg: null as string | null },
] as const;

const recTone = (rec?: string): "pos" | "neg" | "neutral" => {
  const r = (rec || "").toLowerCase();
  if (/buy|outperform|强烈|买入|增持/.test(r)) return "pos";
  if (/sell|avoid|underperform|减持|卖出|回避/.test(r)) return "neg";
  return "neutral";
};

export const StockPickerCard = ({
  payload,
  uiLanguage,
}: {
  payload: StockPickerCardPayload;
  uiLanguage: UILanguage;
}) => {
  const isZh = uiLanguage === "zh";
  const d = payload as unknown as { mode?: string; results?: AnyResult[]; labels?: string[]; droppedTickers?: string[] };
  const t = {
    title: isZh ? "智能选股" : "Stock Picker",
    edge: isZh ? "选股器倾向" : "Stock Picker edge",
    engines: isZh ? "引擎评分" : "Engine Scores",
    score: isZh ? "综合评分" : "Score",
    noData: isZh ? "暂无选股数据" : "No stock picker data available",
  };
  const results: AnyResult[] = Array.isArray(d.results) ? d.results : [];
  const labels: string[] = Array.isArray(d.labels) ? d.labels : [];
  const dropped: string[] = Array.isArray(d.droppedTickers) ? d.droppedTickers : [];
  // A flaky upstream can score one ticker of a comparison but not the other — tell the
  // user which name was dropped instead of silently showing a single-stock card.
  const droppedNotice =
    dropped.length > 0
      ? isZh
        ? `⚠️ 本次未能给 ${dropped.join("、")} 评分,以下仅为其余可用结果——建议稍后重试。`
        : `⚠️ Couldn't score ${dropped.join(", ")} this time — showing the rest; please retry shortly.`
      : null;

  // Trending / screener mode → category list (mirrors the TrendingCard look).
  if (d.mode === "trending") {
    return <TrendingMode payload={d} isZh={isZh} title={t.title} />;
  }

  if (results.length === 0) {
    return (
      <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">💼 {t.noData}</div>
    );
  }

  const nameOf = (r: AnyResult, i: number) => r.ticker || labels[i] || r.companyName || `#${i + 1}`;
  const isCompare = results.length > 1;
  const leaderIdx = results.reduce((best, r, i, arr) => ((r.finalScore ?? 0) > (arr[best].finalScore ?? 0) ? i : best), 0);

  return (
    <CardShell>
      <CardHeader
        icon="💼"
        title={`${t.title} · ${results.map(nameOf).join(" vs ")}`}
        sub={isCompare ? `${t.edge}: ${nameOf(results[leaderIdx], leaderIdx)}` : undefined}
      />
      <div className="space-y-4 p-4">
        {droppedNotice && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">{droppedNotice}</div>
        )}
        {/* Score summary per ticker */}
        <div className={`grid gap-3 ${isCompare ? "grid-cols-2" : "grid-cols-1"}`}>
          {results.map((r, i) => (
            <ScoreSummary key={i} r={r} name={nameOf(r, i)} leader={isCompare && i === leaderIdx} scoreLabel={t.score} />
          ))}
        </div>

        {/* Engine score-off */}
        <Section title={t.engines}>
          <div className="space-y-3">
            {ENGINES.map((e) => (
              <div key={e.scoreKey}>
                <div className="mb-1 text-xs font-medium text-gray-700">{isZh ? e.zh : e.en}</div>
                <div className="space-y-1">
                  {results.map((r, i) => (
                    <div key={i} className="flex items-center gap-2">
                      {isCompare && <span className="w-14 shrink-0 truncate text-[11px] text-gray-500">{nameOf(r, i)}</span>}
                      <div className="flex-1">
                        <ScoreBar value={Number(r[e.scoreKey]) || 0} />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </Section>

        {/* Per-ticker structured breakdown */}
        {results.map((r, i) => (
          <Breakdown key={i} r={r} name={nameOf(r, i)} isZh={isZh} open={!isCompare} />
        ))}
      </div>

      <PickerCta uiLanguage={uiLanguage} />
    </CardShell>
  );
};

const ScoreSummary = ({ r, name, leader, scoreLabel }: { r: AnyResult; name: string; leader: boolean; scoreLabel: string }) => (
  <div className={`rounded-lg border p-3 ${leader ? "border-indigo-300 bg-indigo-50" : "border-gray-200 bg-gray-50"}`}>
    <div className="flex items-baseline justify-between gap-2">
      <span className="truncate font-bold text-gray-900">{name}</span>
      {r.recommendation && <Pill tone={recTone(r.recommendation)}>{r.recommendation}</Pill>}
    </div>
    {r.companyName && r.companyName !== name && <div className="truncate text-[11px] text-gray-500">{r.companyName}</div>}
    <div className="mt-1.5 flex items-baseline gap-1">
      <span className="text-2xl font-extrabold text-gray-900">{Number(r.finalScore ?? 0).toFixed(1)}</span>
      <span className="text-xs text-gray-400">/ 100 · {scoreLabel}</span>
    </div>
    {r.confidence && <div className="mt-0.5 text-[11px] text-gray-500">{r.confidence} confidence</div>}
  </div>
);

const Breakdown = ({ r, name, isZh, open }: { r: AnyResult; name: string; isZh: boolean; open: boolean }) => (
  <details open={open} className="rounded-lg border border-gray-200">
    <summary className="cursor-pointer px-3 py-2 text-sm font-semibold text-gray-700">
      {name} · {isZh ? "引擎明细" : "Engine Breakdown"}
    </summary>
    <div className="space-y-3 border-t border-gray-100 p-3">
      {ENGINES.map((e) => {
        const bd = r[e.bdKey] as AnyResult | undefined;
        if (!bd) return null;
        const score = Number(r[e.scoreKey]);
        return (
          <div key={e.scoreKey}>
            <div className="mb-0.5 flex items-baseline justify-between">
              <span className="text-xs font-bold text-indigo-700">{isZh ? e.zh : e.en}</span>
              {Number.isFinite(score) && <span className="text-[11px] text-gray-500">{Math.round(score)}/100</span>}
            </div>
            {bd.summary && <div className="mb-1 text-xs leading-relaxed text-gray-700">{bd.summary}</div>}
            <Bullets items={bd[e.pos]} tone="pos" />
            {e.neg && <Bullets items={bd[e.neg]} tone="neg" />}
          </div>
        );
      })}
    </div>
  </details>
);

const fmtPct = (v: unknown) => (typeof v === "number" ? `${v >= 0 ? "+" : ""}${v.toFixed(2)}%` : "—");
const fmtPrice = (v: unknown) => (typeof v === "number" ? `$${v.toFixed(2)}` : "—");

const TrendingMode = ({ payload, isZh, title }: { payload: { results?: AnyResult[] }; isZh: boolean; title: string }) => {
  const cat = payload.results?.[0]?.category as AnyResult | undefined;
  const stocks: AnyResult[] = Array.isArray(cat?.stocks) ? cat!.stocks : [];
  return (
    <CardShell>
      <CardHeader icon="💼" title={`${title}${cat?.label ? ` · ${cat.label}` : ""}`} />
      <div className="p-4">
        {stocks.length === 0 ? (
          <div className="text-sm text-gray-500">{isZh ? "暂无数据" : "No data"}</div>
        ) : (
          <div className="overflow-hidden rounded-lg border border-gray-200">
            <table className="w-full border-collapse text-xs">
              <tbody>
                {stocks.slice(0, 10).map((s, i) => (
                  <tr key={s.ticker || i} className="border-b border-gray-100 last:border-0">
                    <td className="px-2.5 py-1.5 text-gray-500">{i + 1}</td>
                    <td className="px-1 py-1.5">
                      <div className="text-[13px] font-bold text-gray-800">{s.ticker}</div>
                      {s.companyName && <div className="max-w-[140px] truncate text-[10px] text-gray-400">{s.companyName}</div>}
                    </td>
                    <td className="px-2.5 py-1.5 text-right font-semibold text-gray-800">{fmtPrice(s.price)}</td>
                    <td className={`px-2.5 py-1.5 text-right font-bold ${(s.changePercent ?? 0) >= 0 ? "text-emerald-500" : "text-red-500"}`}>
                      {fmtPct(s.changePercent)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </CardShell>
  );
};

const PickerCta = ({ uiLanguage }: { uiLanguage: UILanguage }) => {
  const meta = MODULE_META.stockpicker;
  return (
    <div className="flex items-center gap-2 border-t border-gray-100 px-4 py-2.5" data-testid="follow-up-stockpicker">
      <span className="text-base">{meta.icon}</span>
      <div className="min-w-0 flex-1">
        <p className="text-[10px] text-gray-500">{UI_TEXTS[uiLanguage].goDeeperWith}</p>
        <p className="truncate text-xs font-medium text-gray-800">{uiLanguage === "zh" ? meta.labelZh : meta.label}</p>
      </div>
      <button
        onClick={() => window.open(meta.url, "_blank")}
        className="shrink-0 rounded-md bg-gray-900 px-2.5 py-1 text-[10px] text-white transition-colors hover:bg-gray-700"
        data-testid="button-open-stockpicker"
      >
        {UI_TEXTS[uiLanguage].open}
      </button>
    </div>
  );
};
