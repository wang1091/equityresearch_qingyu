import type { TrendingResponse, TrendingCategory, TrendingStock } from "@shared/trending";
import type { UILanguage } from "@/utils/i18n";

/**
 * Frontend renderer for the TRENDING card — structured replacement for
 * server/agent/formatters/trending.ts. Consumes the shared TrendingResponse;
 * renders each category as a Top-10 table. Handles the upstream-unavailable
 * (success:false) and empty states (TRENDING bypasses the api-failure gate, so a
 * failed payload still reaches this card). Generic source_card channel
 * (docs/CARD_RENDER_MIGRATION_PLAN.md).
 */
const CATEGORY_META: Record<string, { icon: string; labelEn: string; labelZh: string; color: string }> = {
  most_discussed: { icon: "💬", labelEn: "Most Discussed", labelZh: "最热门讨论", color: "text-indigo-500" },
  most_active: { icon: "🔥", labelEn: "Most Active", labelZh: "最活跃交易", color: "text-amber-500" },
  top_gainers: { icon: "📈", labelEn: "Top Gainers", labelZh: "涨幅最大", color: "text-emerald-500" },
  top_losers: { icon: "📉", labelEn: "Top Losers", labelZh: "跌幅最大", color: "text-red-500" },
};

export const TrendingCard = ({
  payload,
  uiLanguage,
}: {
  payload: TrendingResponse;
  uiLanguage: UILanguage;
}) => {
  const isZh = uiLanguage === "zh";
  const d = payload as { success?: boolean; date?: string; categories?: TrendingCategory[]; category?: TrendingCategory; id?: string };

  const t = {
    title: isZh ? "今日市场行情" : "Today's Market Movers",
    source: isZh ? "数据来源: Yahoo Finance · X" : "Source: Yahoo Finance · X",
    unavailable: isZh ? "行情数据暂时不可用，请稍后重试" : "Market data temporarily unavailable — please try again shortly",
    noData: isZh ? "暂无行情数据" : "No trending data available",
    stock: isZh ? "股票" : "Stock",
    price: isZh ? "价格" : "Price",
    change: isZh ? "涨跌" : "Change",
    top10: isZh ? "前10" : "Top 10",
  };

  if (!d || d.success === false) {
    return (
      <Shell title={t.title} date="">
        <div className="px-2 py-6 text-center text-sm text-gray-500">{t.unavailable}</div>
      </Shell>
    );
  }

  // category resolution mirrors the formatter (categories[] | category | self).
  const categories: TrendingCategory[] = Array.isArray(d.categories)
    ? d.categories
    : d.category?.id
      ? [d.category]
      : d.id
        ? [d as unknown as TrendingCategory]
        : [];

  if (categories.length === 0) return <div className="rounded-xl bg-white p-4 text-sm text-gray-500 shadow-sm">{t.noData}</div>;

  return (
    <Shell title={t.title} date={`${t.source} · ${d.date || new Date().toISOString().split("T")[0]}`}>
      {categories.map((cat, i) => (
        <CategoryTable key={cat.id || i} cat={cat} isZh={isZh} labels={t} />
      ))}
    </Shell>
  );
};

const Shell = ({ title, date, children }: { title: string; date: string; children: React.ReactNode }) => (
  <div className="overflow-hidden rounded-xl bg-white shadow-sm">
    <div className="bg-gradient-to-br from-slate-800 to-slate-600 px-4 py-3.5 text-white">
      <div className="text-[15px] font-bold">📊 {title}</div>
      {date && <div className="mt-0.5 text-[11px] opacity-70">{date}</div>}
    </div>
    <div className="p-4">{children}</div>
  </div>
);

const fmtPct = (v: number | undefined) => (v == null ? "—" : `${v >= 0 ? "+" : ""}${v.toFixed(2)}%`);
const fmtPrice = (v: number | undefined) => (v != null ? `$${v.toFixed(2)}` : "—");
const pctClass = (v: number | undefined) => (v == null ? "text-gray-500" : v >= 0 ? "text-emerald-500" : "text-red-500");

const CategoryTable = ({
  cat,
  isZh,
  labels,
}: {
  cat: TrendingCategory;
  isZh: boolean;
  labels: { stock: string; price: string; change: string; top10: string };
}) => {
  const meta = CATEGORY_META[cat.id] || { icon: "📊", labelEn: cat.label || cat.id, labelZh: cat.label || cat.id, color: "text-indigo-500" };
  const stocks = (cat.stocks || []).slice(0, 10);

  return (
    <div className="mb-4 last:mb-0">
      <div className="mb-2 flex items-center gap-1.5">
        <span className="text-base">{meta.icon}</span>
        <span className={`text-[13px] font-bold ${meta.color}`}>{isZh ? meta.labelZh : meta.labelEn}</span>
        <span className="ml-auto text-[11px] text-gray-400">{labels.top10}</span>
      </div>
      <div className="overflow-hidden rounded-lg border border-gray-200">
        <table className="w-full border-collapse text-xs">
          <thead>
            <tr className="border-b-2 border-slate-200 bg-slate-50 text-[10px] font-semibold text-gray-400">
              <th className="w-7 px-2.5 py-1.5 text-left">#</th>
              <th className="px-1 py-1.5 text-left">{labels.stock}</th>
              <th className="px-2.5 py-1.5 text-right">{labels.price}</th>
              <th className="px-2.5 py-1.5 text-right">{labels.change}</th>
            </tr>
          </thead>
          <tbody>
            {stocks.map((s: TrendingStock, i: number) => (
              <tr key={s.ticker || i} className="border-b border-gray-100 last:border-0">
                <td className="px-2.5 py-1.5 text-gray-500">{i + 1}</td>
                <td className="px-1 py-1.5">
                  <div className="text-[13px] font-bold text-gray-800">{s.ticker}</div>
                  {s.companyName && <div className="max-w-[120px] truncate text-[10px] text-gray-400">{s.companyName}</div>}
                  {s.discussion_highlights?.[0] && <div className="truncate text-[10px] text-gray-400">{s.discussion_highlights[0]}</div>}
                </td>
                <td className="px-2.5 py-1.5 text-right text-[13px] font-semibold text-gray-800">{fmtPrice(s.price)}</td>
                <td className={`px-2.5 py-1.5 text-right text-[13px] font-bold ${pctClass(s.changePercent)}`}>{fmtPct(s.changePercent)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};
