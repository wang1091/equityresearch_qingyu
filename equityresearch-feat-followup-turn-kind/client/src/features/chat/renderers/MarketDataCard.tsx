import type { MarketDataResponse, QuoteData, HistoricalPoint, CalculatedMetrics } from "@shared/marketData";
import type { UILanguage } from "@/utils/i18n";

/**
 * Frontend renderer for the MARKET_DATA card — structured replacement for
 * server/agent/formatters/marketData.ts. Consumes the shared MarketDataResponse:
 * calculated-results block (returns/portfolio), a return-comparison block, then a
 * quote card per ticker. Generic source_card channel (docs/CARD_RENDER_MIGRATION_PLAN.md).
 */
const fmtPct = (v: number | null | undefined, decimals = 2) => (v == null ? "—" : `${v >= 0 ? "+" : ""}${v.toFixed(decimals)}%`);
const fmtPrice = (v: number | null | undefined) => (v == null ? "—" : `$${v.toFixed(2)}`);
const fmtLarge = (v: number | null | undefined): string => {
  if (v == null) return "—";
  const a = Math.abs(v);
  if (a >= 1e12) return `$${(v / 1e12).toFixed(2)}T`;
  if (a >= 1e9) return `$${(v / 1e9).toFixed(2)}B`;
  if (a >= 1e6) return `$${(v / 1e6).toFixed(2)}M`;
  return `$${v.toFixed(0)}`;
};
const fmtVol = (v: number | null | undefined): string => {
  if (v == null) return "—";
  if (v >= 1e9) return `${(v / 1e9).toFixed(2)}B`;
  if (v >= 1e6) return `${(v / 1e6).toFixed(2)}M`;
  if (v >= 1e3) return `${(v / 1e3).toFixed(0)}K`;
  return String(v);
};
const pctClass = (v: number | null | undefined) => (v == null ? "text-gray-500" : v >= 0 ? "text-emerald-500" : "text-red-500");

export const MarketDataCard = ({
  payload,
  uiLanguage,
}: {
  payload: MarketDataResponse;
  uiLanguage: UILanguage;
}) => {
  const isZh = uiLanguage === "zh";

  if (!payload?.success) {
    return (
      <div className="rounded-lg border-l-4 border-amber-500 bg-amber-50 px-4 py-3.5 text-sm text-amber-800">
        {isZh ? "市场数据暂时不可用" : "Market data unavailable"}
      </div>
    );
  }

  const d = payload;
  const quotes = d.quotes ?? [];
  const calc = d.calculated ?? {};
  const hist = d.historical ?? {};
  const provider = (d.provider || "fmp").toUpperCase();
  const fetchedAt = d.fetchedAt ? new Date(d.fetchedAt).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" }) : "";

  return (
    <div>
      <CalculatedBlock calc={calc} isZh={isZh} />
      {d.queryType === "comparison" && <ReturnComparison hist={hist} isZh={isZh} />}
      {quotes.map((q) => (
        <QuoteCard key={q.ticker} q={q} isZh={isZh} />
      ))}
      <div className="mt-1 text-right text-[10px] text-gray-400">
        {isZh ? "数据来源" : "Source"}: {provider}{fetchedAt ? ` · ${fetchedAt}` : ""}
      </div>
    </div>
  );
};

const CalculatedBlock = ({ calc, isZh }: { calc: CalculatedMetrics; isZh: boolean }) => {
  const items: [string, string][] = (
    [
      [isZh ? "年初至今回报" : "YTD Return", calc.ytdReturnPct],
      [isZh ? "总回报" : "Total Return", calc.totalReturnPct],
      [isZh ? "初始投资" : "Invested", calc.hypotheticalInvested],
      [isZh ? "当前价值" : "Current Value", calc.hypotheticalValue],
      [isZh ? "市值" : "Market Cap", calc.marketCapFmt],
      [isZh ? "市盈率" : "P/E", calc.peRatio],
      [isZh ? "市销率" : "P/S", calc.psRatio],
      [isZh ? "EV/EBITDA" : "EV/EBITDA", calc.evEbitdaFmt],
      [isZh ? "股息率" : "Dividend Yield", calc.dividendYieldPct],
    ] as [string, string | undefined][]
  ).filter((x): x is [string, string] => !!x[1] && x[1].length > 0);
  if (items.length === 0) return null;

  return (
    <div className="mb-3 rounded-[10px] border border-emerald-300 bg-emerald-50 px-4 py-3.5">
      <div className="mb-2.5 text-[11px] font-bold uppercase tracking-wider text-emerald-800">📊 {isZh ? "计算结果" : "Calculated Results"}</div>
      <div className="grid grid-cols-2 gap-2">
        {items.map(([label, val]) => (
          <div key={label} className="rounded-md border border-emerald-100 bg-white px-2.5 py-2">
            <div className="mb-0.5 text-[10px] text-gray-500">{label}</div>
            <div className="text-sm font-bold text-emerald-800">{val}</div>
          </div>
        ))}
      </div>
    </div>
  );
};

const ReturnComparison = ({ hist, isZh }: { hist: Record<string, HistoricalPoint[]>; isZh: boolean }) => {
  const tickers = Object.keys(hist);
  if (tickers.length <= 1) return null;
  const comps = tickers
    .map((tk) => {
      const pts = hist[tk];
      if (!pts || pts.length < 2) return null;
      const start = pts[0].close;
      const end = pts[pts.length - 1].close;
      return { ticker: tk, ret: ((end - start) / start) * 100 };
    })
    .filter((c): c is { ticker: string; ret: number } => c !== null)
    .sort((a, b) => b.ret - a.ret);
  if (comps.length <= 1) return null;

  return (
    <div className="mb-3 rounded-[10px] border border-slate-200 bg-slate-50 px-4 py-3.5">
      <div className="mb-2 text-[11px] font-bold uppercase tracking-wider text-slate-600">📈 {isZh ? "回报对比" : "Return Comparison"}</div>
      {comps.map((c, i) => (
        <div key={c.ticker} className={`flex items-center justify-between py-1.5 ${i < comps.length - 1 ? "border-b border-slate-200" : ""}`}>
          <div className="text-[13px] font-semibold text-slate-800">{c.ticker}</div>
          <div className={`text-sm font-bold ${c.ret >= 0 ? "text-emerald-500" : "text-red-500"}`}>{fmtPct(c.ret)}</div>
        </div>
      ))}
    </div>
  );
};

const QuoteCard = ({ q, isZh }: { q: QuoteData; isZh: boolean }) => {
  const chg = q.changePercent ?? 0;
  const up = chg >= 0;
  const rows: [string, string][] = (
    [
      [isZh ? "当前价格" : "Price", fmtPrice(q.price)],
      [isZh ? "涨跌" : "Change", `${up ? "+" : ""}${q.change?.toFixed(2) ?? "—"} (${fmtPct(chg)})`],
      [isZh ? "市值" : "Market Cap", fmtLarge(q.marketCap)],
      [isZh ? "成交量" : "Volume", fmtVol(q.volume)],
      [isZh ? "市盈率" : "P/E", q.pe != null ? `${q.pe.toFixed(1)}x` : "—"],
      [isZh ? "市销率" : "P/S", q.ps != null ? `${q.ps.toFixed(1)}x` : "—"],
      [isZh ? "EV/EBITDA" : "EV/EBITDA", q.evEbitda != null ? `${q.evEbitda.toFixed(1)}x` : "—"],
      [isZh ? "股息率" : "Div Yield", q.dividendYield != null ? `${q.dividendYield.toFixed(2)}%` : "—"],
      [isZh ? "年初至今" : "YTD Return", q.ytdReturn != null ? fmtPct(q.ytdReturn) : "—"],
      [isZh ? "52周高" : "52W High", fmtPrice(q.fiftyTwoWeekHigh)],
      [isZh ? "52周低" : "52W Low", fmtPrice(q.fiftyTwoWeekLow)],
      [isZh ? "Beta" : "Beta", q.beta != null ? q.beta.toFixed(2) : "—"],
    ] as [string, string][]
  ).filter(([, v]) => v !== "—");

  return (
    <div className="mb-3 overflow-hidden rounded-[10px] border border-gray-200 bg-white">
      <div className="flex items-center justify-between bg-gradient-to-br from-slate-800 to-slate-600 px-4 py-3 text-white">
        <div className="min-w-0">
          <div className="text-[15px] font-bold">{q.ticker}</div>
          <div className="truncate text-[11px] opacity-70">{[q.companyName, q.exchange].filter(Boolean).join(" · ")}</div>
        </div>
        <div className="text-right">
          <div className="text-xl font-extrabold">{fmtPrice(q.price)}</div>
          <div className={`text-xs font-semibold ${pctClass(chg)}`}>{up ? "▲" : "▼"} {fmtPct(chg)}</div>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2 p-4">
        {rows.map(([label, val]) => (
          <div key={label} className="rounded-md bg-slate-50 px-2.5 py-2">
            <div className="mb-0.5 text-[10px] text-gray-500">{label}</div>
            <div className="text-[13px] font-semibold text-gray-800">{val}</div>
          </div>
        ))}
      </div>
    </div>
  );
};
