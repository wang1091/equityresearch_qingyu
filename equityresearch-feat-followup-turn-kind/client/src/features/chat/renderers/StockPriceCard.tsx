import type { StockPriceResponse, StockPriceChartPoint } from "@shared/stockPrice";
import type { UILanguage } from "@/utils/i18n";

/**
 * Frontend renderer for the STOCK_PRICE card — structured replacement for
 * server/agent/formatters/stockPrice.ts. Consumes the shared StockPriceResponse
 * contract; labels are bilingual, numbers formatted client-side. Generic
 * source_card channel (see docs/CARD_RENDER_MIGRATION_PLAN.md).
 */
export const StockPriceCard = ({
  payload,
  uiLanguage,
}: {
  payload: StockPriceResponse;
  uiLanguage: UILanguage;
}) => {
  const isZh = uiLanguage === "zh";
  const d = payload;
  const quote = d.currentPrice ?? ({} as StockPriceResponse["currentPrice"]);
  const dayRange = d.dayRange ?? ({} as StockPriceResponse["dayRange"]);
  const fiftyTwoWeek = d.fiftyTwoWeekRange ?? ({} as StockPriceResponse["fiftyTwoWeekRange"]);

  const change = quote.change ?? 0;
  const isPositive = change >= 0;

  const t = {
    title: isZh ? "股价" : "Stock Price",
    prevClose: isZh ? "前收盘价" : "Prev Close",
    trend: isZh ? "今日价格走势" : "Today's Price Movement",
    open: isZh ? "开盘" : "Open",
    last: isZh ? "最新" : "Last",
    dayRange: isZh ? "日内区间" : "Day Range",
    weekRange: isZh ? "52周区间" : "52-Week Range",
    volume: isZh ? "成交量" : "Volume",
    marketCap: isZh ? "市值" : "Market Cap",
  };

  const ccy = (v: number | null | undefined) => {
    if (typeof v !== "number") return "—";
    const sym = d.currency && d.currency !== "USD" ? `${d.currency} ` : "$";
    return `${sym}${v.toFixed(2)}`;
  };
  const money = (v: number | null | undefined) => (typeof v === "number" ? `$${v.toFixed(2)}` : "—");
  const fmtVol = (v: number | null | undefined) => {
    if (!v) return "N/A";
    if (v >= 1e9) return `${(v / 1e9).toFixed(2)}B`;
    if (v >= 1e6) return `${(v / 1e6).toFixed(2)}M`;
    if (v >= 1e3) return `${(v / 1e3).toFixed(1)}K`;
    return String(v);
  };
  const marketState = localizeMarketState(d.marketState, isZh);

  const headerGradient = isPositive
    ? "bg-gradient-to-br from-emerald-800 to-emerald-500"
    : "bg-gradient-to-br from-red-800 to-red-500";

  return (
    <div className="overflow-hidden rounded-xl bg-white shadow-sm">
      {/* Price header */}
      <div className={`${headerGradient} px-5 py-5 text-white`}>
        <div className="flex items-center justify-between">
          <div className="text-xs opacity-80">
            {d.ticker}
            {d.exchangeName ? ` · ${d.exchangeName}` : ""}
          </div>
          {marketState && (
            <div className="rounded bg-white/20 px-2 py-0.5 text-[11px] opacity-80">{marketState}</div>
          )}
        </div>
        <div className="mt-2 flex items-baseline gap-3">
          <span className="text-3xl font-bold">{ccy(quote.price)}</span>
          <span className="text-base font-semibold">
            {isPositive ? "▲" : "▼"} {Math.abs(change).toFixed(2)} ({(quote.changePercent ?? 0).toFixed(2)}%)
          </span>
        </div>
        {quote.previousClose != null && (
          <div className="mt-1 text-xs opacity-70">
            {t.prevClose}: {money(quote.previousClose)}
          </div>
        )}
      </div>

      {/* Intraday sparkline */}
      <MiniChart points={d.chartData ?? []} positive={isPositive} labels={t} ticker={d.ticker} />

      {/* Key metrics grid */}
      <div className="grid grid-cols-2 gap-3 px-4 pb-4 pt-3">
        {dayRange.high != null && dayRange.low != null && (
          <Metric label={t.dayRange} value={`${money(dayRange.low)} - ${money(dayRange.high)}`} />
        )}
        {fiftyTwoWeek.high != null && fiftyTwoWeek.low != null && (
          <Metric label={t.weekRange} value={`${money(fiftyTwoWeek.low)} - ${money(fiftyTwoWeek.high)}`} />
        )}
        {!!d.volume && <Metric label={t.volume} value={fmtVol(d.volume)} />}
        {!!d.marketCap && <Metric label={t.marketCap} value={fmtVol(d.marketCap)} />}
      </div>

      {/* Timestamp */}
      <div className="bg-gray-50 px-4 py-2 text-right text-[11px] text-gray-400">
        {new Date(d.timestamp || Date.now()).toLocaleString(isZh ? "zh-CN" : "en-US")}
      </div>
    </div>
  );
};

const Metric = ({ label, value }: { label: string; value: string }) => (
  <div className="rounded-lg bg-gray-50 p-2.5">
    <div className="text-[11px] text-gray-500">{label}</div>
    <div className="mt-0.5 font-semibold text-gray-800">{value}</div>
  </div>
);

const MiniChart = ({
  points,
  positive,
  labels,
  ticker,
}: {
  points: StockPriceChartPoint[];
  positive: boolean;
  labels: { trend: string; open: string; last: string };
  ticker: string;
}) => {
  const prices = (points ?? []).map((p) => p.c).filter((c): c is number => typeof c === "number");
  if (prices.length < 2) return null;

  const minP = Math.min(...prices);
  const maxP = Math.max(...prices);
  const range = maxP - minP || 1;
  const width = 600;
  const height = 80;
  const padX = 10;

  const coords = prices.map((p, i) => {
    const x = padX + (i / (prices.length - 1)) * (width - padX * 2);
    const y = height - ((p - minP) / range) * (height - 10) - 5;
    return `${x},${y}`;
  });
  const line = coords.join(" ");
  const fill = `${padX},${height} ${line} ${width - padX},${height}`;
  const color = positive ? "#10b981" : "#ef4444";
  const gradId = `spark-${ticker}`;

  return (
    <div className="px-4 pb-1 pt-2">
      <div className="mb-1 text-[11px] text-gray-500">{labels.trend}</div>
      <svg viewBox={`0 0 ${width} ${height}`} className="h-20 w-full" preserveAspectRatio="none">
        <defs>
          <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.3" />
            <stop offset="100%" stopColor={color} stopOpacity="0" />
          </linearGradient>
        </defs>
        <polygon points={fill} fill={`url(#${gradId})`} />
        <polyline
          points={line}
          fill="none"
          stroke={color}
          strokeWidth={2}
          strokeLinejoin="round"
          strokeLinecap="round"
        />
      </svg>
      <div className="mt-0.5 flex justify-between text-[10px] text-gray-400">
        <span>
          {labels.open} ${prices[0].toFixed(2)}
        </span>
        <span>
          {labels.last} ${prices[prices.length - 1].toFixed(2)}
        </span>
      </div>
    </div>
  );
};

/** Mirror of server formatters/_shared.ts localizeMarketState (label-only). */
function localizeMarketState(state: string | null, isZh: boolean): string {
  if (!state) return "";
  if (!isZh) return state;
  const map: Record<string, string> = {
    pre: "盘前",
    premarket: "盘前",
    regular: "盘中",
    post: "盘后",
    postmarket: "盘后",
    closed: "已收盘",
    open: "开盘",
  };
  return map[state.toLowerCase()] ?? state;
}
