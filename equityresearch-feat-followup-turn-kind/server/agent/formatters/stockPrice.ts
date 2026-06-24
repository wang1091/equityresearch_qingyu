// server/agent/formatters/stockPrice.ts
// Extracted verbatim from cardFormatter.ts (per-source split) — no behavior change.
import {
  getLocale,
  localizeMarketState,
} from "./_shared";

export function formatStockPriceCard(data: any, language: string = "en"): string {
  const ticker = data.ticker || "N/A";
  const price = data.currentPrice?.price ?? data.currentPrice ?? 0;
  const change = data.currentPrice?.change ?? data.change ?? 0;
  const changePercent = data.currentPrice?.changePercent ?? data.changePercent ?? 0;
  const previousClose = data.currentPrice?.previousClose ?? data.previousClose ?? 0;

  const isPositive = change >= 0;
  const changeColor = isPositive ? "#10b981" : "#ef4444";
  const changeIcon = isPositive ? "▲" : "▼";
  const bgGradient = isPositive
    ? "linear-gradient(135deg, #065f46 0%, #10b981 100%)"
    : "linear-gradient(135deg, #991b1b 0%, #ef4444 100%)";

  const dayRange = data.dayRange || {};
  const fiftyTwoWeek = data.fiftyTwoWeekRange || {};
  const volume = typeof data.volume === "number" ? data.volume : 0;
  const marketCap = typeof data.marketCap === "number" ? data.marketCap : 0;
  const currency = data.currency || "USD";
  const exchangeName = data.exchangeName || "";
  const marketState = data.marketState || "";

  const fmtVol = (v: number) => {
    if (!v) return "N/A";
    if (v >= 1e9) return `${(v / 1e9).toFixed(2)}B`;
    if (v >= 1e6) return `${(v / 1e6).toFixed(2)}M`;
    if (v >= 1e3) return `${(v / 1e3).toFixed(1)}K`;
    return v.toString();
  };

  const renderMiniChart = (chartData: any[], positive: boolean): string => {
    if (!chartData || chartData.length < 2) return "";

    const prices = chartData.map((d: any) => d.c).filter(Boolean);
    if (prices.length < 2) return "";

    const minP = Math.min(...prices);
    const maxP = Math.max(...prices);
    const range = maxP - minP || 1;

    const width = 600;
    const height = 80;
    const padX = 10;

    const points = prices
      .map((p: number, i: number) => {
        const x = padX + (i / (prices.length - 1)) * (width - padX * 2);
        const y = height - ((p - minP) / range) * (height - 10) - 5;
        return `${x},${y}`;
      })
      .join(" ");

    const firstX = padX;
    const lastX = width - padX;
    const fillPoints = `${firstX},${height} ${points} ${lastX},${height}`;

    const color = positive ? "#10b981" : "#ef4444";

    // 首尾价格标注
    const firstPrice = prices[0];
    const lastPrice = prices[prices.length - 1];

    return `
    <div style="padding: 0 16px 4px;">
      <div style="font-size: 11px; color: #6b7280; margin-bottom: 4px;">${language === "zh" ? "今日价格走势" : "Today's Price Movement"}</div>
      <svg viewBox="0 0 ${width} ${height}" style="width:100%; height:80px;">
        <defs>
          <linearGradient id="chartGrad${ticker}" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="${color}" stop-opacity="0.3"/>
            <stop offset="100%" stop-color="${color}" stop-opacity="0"/>
          </linearGradient>
        </defs>
        <polygon points="${fillPoints}" fill="url(#chartGrad${ticker})"/>
        <polyline points="${points}" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>
      </svg>
      <div style="display: flex; justify-content: space-between; font-size: 10px; color: #9ca3af; margin-top: 2px;">
        <span>${language === "zh" ? "开盘" : "Open"} $${Number(firstPrice).toFixed(2)}</span>
        <span>${language === "zh" ? "最新" : "Last"} $${Number(lastPrice).toFixed(2)}</span>
      </div>
    </div>`;
  };

  const isZh = language === "zh";
  const localizedMarketState = localizeMarketState(marketState, language);
  return `<strong>📈 ${isZh ? "股价" : "Stock Price"} - ${ticker}</strong><br><br>
    <div style="background: white; border-radius: 12px; box-shadow: 0 2px 8px rgba(0,0,0,0.1); overflow: hidden;">

      <!-- 价格头部 -->
      <div style="background: ${bgGradient}; padding: 20px; color: white;">
        <div style="display: flex; justify-content: space-between; align-items: center;">
          <div style="font-size: 12px; opacity: 0.8;">${ticker}${exchangeName ? ` · ${exchangeName}` : ""}</div>
          ${localizedMarketState ? `<div style="font-size: 11px; opacity: 0.7; background: rgba(255,255,255,0.2); padding: 3px 8px; border-radius: 4px;">${localizedMarketState}</div>` : ""}
        </div>
        <div style="display: flex; align-items: baseline; gap: 12px; margin-top: 8px;">
          <span style="font-size: 32px; font-weight: bold;">${currency !== "USD" ? currency + " " : "$"}${Number(price).toFixed(2)}</span>
          <span style="font-size: 16px; font-weight: 600;">
            ${changeIcon} ${Math.abs(Number(change)).toFixed(2)} (${Number(changePercent).toFixed(2)}%)
          </span>
        </div>
        ${previousClose ? `<div style="font-size: 12px; opacity: 0.7; margin-top: 4px;">${isZh ? "前收盘价" : "Prev Close"}: $${Number(previousClose).toFixed(2)}</div>` : ""}
      </div>

      <!-- 日内走势图 -->
      ${renderMiniChart(data.chartData || [], isPositive)}

      <!-- 关键指标网格 -->
      <div style="padding: 12px 16px 16px; display: grid; grid-template-columns: repeat(2, 1fr); gap: 12px;">
        ${dayRange.high && dayRange.low ? `
        <div style="padding: 10px; background: #f9fafb; border-radius: 8px;">
          <div style="font-size: 11px; color: #6b7280;">${isZh ? "日内区间" : "Day Range"}</div>
          <div style="font-weight: 600; color: #1f2937; margin-top: 2px;">$${Number(dayRange.low).toFixed(2)} - $${Number(dayRange.high).toFixed(2)}</div>
        </div>` : ""}
        ${fiftyTwoWeek.high && fiftyTwoWeek.low ? `
        <div style="padding: 10px; background: #f9fafb; border-radius: 8px;">
          <div style="font-size: 11px; color: #6b7280;">${isZh ? "52周区间" : "52-Week Range"}</div>
          <div style="font-weight: 600; color: #1f2937; margin-top: 2px;">$${Number(fiftyTwoWeek.low).toFixed(2)} - $${Number(fiftyTwoWeek.high).toFixed(2)}</div>
        </div>` : ""}
        ${volume > 0 ? `
        <div style="padding: 10px; background: #f9fafb; border-radius: 8px;">
          <div style="font-size: 11px; color: #6b7280;">${isZh ? "成交量" : "Volume"}</div>
          <div style="font-weight: 600; color: #1f2937; margin-top: 2px;">${fmtVol(volume)}</div>
        </div>` : ""}
        ${marketCap > 0 ? `
        <div style="padding: 10px; background: #f9fafb; border-radius: 8px;">
          <div style="font-size: 11px; color: #6b7280;">${isZh ? "市值" : "Market Cap"}</div>
          <div style="font-weight: 600; color: #1f2937; margin-top: 2px;">${fmtVol(marketCap)}</div>
        </div>` : ""}
      </div>

      <!-- 时间戳 -->
      <div style="padding: 8px 16px; background: #f9fafb; font-size: 11px; color: #9ca3af; text-align: right;">
        ${data.timestamp ? new Date(data.timestamp).toLocaleString(getLocale(language)) : new Date().toLocaleString(getLocale(language))}
      </div>
    </div>`;
}
