/**
 * Per-ticker market quote fetch services (Yahoo Finance / FMP). Extracted from
 * routes/quotes.ts (per-source service split) — no behavior change. The route
 * handlers (routes/quotes.ts) are thin (req,res) wrappers over these; the agent
 * (planRegistry) calls the services directly instead of a loopback self-call.
 * Yahoo is still a bare fetch here (unchanged — hardening Yahoo is a separate
 * A-layer task); FMP already goes through the shared hardened client (fmpFetch).
 */
import { YAHOO_QUERY1, YAHOO_QUERY2 } from "../config/providers";
import { fmpFetch } from "../marketData/marketDataService";

const YAHOO_UA_SHORT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36";

export interface StockPriceOptions {
  range?: string;
  interval?: string;
  includeHistory?: boolean;
}

/** Live price + (optional) intraday chart for a ticker. Yahoo chart + FMP profile
 *  (marketCap) in parallel; FMP is best-effort (falls back to chart meta). Throws
 *  on a Yahoo chart failure. */
export async function fetchStockPrice(
  ticker: string,
  opts: StockPriceOptions = {},
): Promise<Record<string, unknown>> {
  const range = opts.range ?? "1d";
  const interval = opts.interval ?? "2m";
  const includeHistory = opts.includeHistory ?? true;
  const upperTicker = ticker.toUpperCase();
  const yHeaders = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    "Accept": "application/json",
    "Accept-Language": "en-US,en;q=0.9",
    "Cache-Control": "no-cache",
  };
  const chartUrl = `${YAHOO_QUERY2}/v8/finance/chart/${upperTicker}?range=${range}&interval=${interval}&includePrePost=true`;

  const [chartRes, fmpRes] = await Promise.allSettled([
    fetch(chartUrl, { headers: yHeaders }),
    fmpFetch(`profile?symbol=${upperTicker}`),
  ]);

  if (chartRes.status === "rejected" || !chartRes.value.ok) {
    throw new Error(`Yahoo Finance chart API error`);
  }

  const data = await chartRes.value.json();
  const result = data.chart?.result?.[0];
  if (!result) {
    throw new Error("No data returned from Yahoo Finance");
  }

  let marketCapValue: number | null = null;
  if (fmpRes.status === "fulfilled") {
    marketCapValue = (fmpRes.value as any)?.[0]?.marketCap ?? null;
  }

  const meta = result.meta;
  const quote = result.indicators?.quote?.[0];
  const timestamps = result.timestamp || [];

  const currentPrice = meta.regularMarketPrice || 0;
  const previousClose = meta.chartPreviousClose || meta.previousClose || 0;
  const change = currentPrice - previousClose;
  const changePercent = previousClose !== 0 ? (change / previousClose) * 100 : 0;

  const responseData: any = {
    success: true,
    ticker: upperTicker,
    currency: meta.currency || "USD",
    exchangeName: meta.exchangeName || "N/A",
    currentPrice: { price: currentPrice, change, changePercent, previousClose },
    dayRange: { high: meta.regularMarketDayHigh || 0, low: meta.regularMarketDayLow || 0 },
    fiftyTwoWeekRange: { high: meta.fiftyTwoWeekHigh || null, low: meta.fiftyTwoWeekLow || null },
    marketState: meta.marketState || "REGULAR",
    volume: meta.regularMarketVolume || 0,
    marketCap: marketCapValue ?? meta.marketCap ?? null,
    timestamp: new Date().toISOString(),
  };

  if (includeHistory && timestamps.length > 0) {
    responseData.chartData = timestamps
      .map((ts: number, i: number) => ({
        t: ts * 1000,
        c: quote?.close?.[i] ?? null,
        v: quote?.volume?.[i] ?? null,
      }))
      .filter((d: any) => d.c !== null);
  }

  return responseData;
}

/** Yahoo "recommendations by symbol" → up to 10 similar tickers. Throws on error. */
export async function fetchSimilarStocks(ticker: string): Promise<Record<string, unknown>> {
  const upperTicker = ticker.toUpperCase();
  const yahooUrl = `${YAHOO_QUERY2}/v6/finance/recommendationsbysymbol/${upperTicker}`;
  const response = await fetch(yahooUrl, { headers: { "User-Agent": YAHOO_UA_SHORT } });
  if (!response.ok) {
    throw new Error(`Yahoo Finance API error: ${response.status}`);
  }
  const data = await response.json();
  const recommendations = data.finance?.result?.[0]?.recommendedSymbols || [];
  return {
    success: true,
    ticker: upperTicker,
    similarStocks: recommendations.slice(0, 10).map((rec: any) => ({ symbol: rec.symbol, score: rec.score })),
    count: recommendations.length,
    timestamp: new Date().toISOString(),
  };
}

/** Analyst ratings from Yahoo insights (+ current price from chart). `detail`
 *  returns the rich card (technical/levels/scores/bull-bear/reports); otherwise
 *  the simplified shape the multi-intent path uses. Throws on a Yahoo failure. */
export async function fetchAnalystRating(
  ticker: string,
  opts: { detail: boolean },
): Promise<Record<string, unknown>> {
  const upperTicker = ticker.toUpperCase();
  const [insightsRes, chartRes] = await Promise.all([
    fetch(`${YAHOO_QUERY2}/ws/insights/v2/finance/insights?symbol=${upperTicker}`, {
      headers: { "User-Agent": YAHOO_UA_SHORT },
    }),
    fetch(`${YAHOO_QUERY1}/v8/finance/chart/${upperTicker}?interval=1d&range=1d`, {
      headers: { "User-Agent": YAHOO_UA_SHORT },
    }),
  ]);

  if (!insightsRes.ok) throw new Error(`Yahoo Insights API error: ${insightsRes.status}`);
  const data = await insightsRes.json();
  const result = data.finance?.result;
  if (!result) throw new Error("No data returned");

  const tech = result.instrumentInfo?.technicalEvents || {};
  const val = result.instrumentInfo?.valuation || {};
  const key = result.instrumentInfo?.keyTechnicals || {};
  const rec = result.recommendation || {};
  const sigDevs = result.sigDevs || [];

  if (!opts.detail) {
    let currentPrice = 0;
    if (chartRes.ok) {
      try {
        const chartData = await chartRes.json();
        currentPrice = chartData?.chart?.result?.[0]?.meta?.regularMarketPrice || 0;
        if (!currentPrice) {
          const quotes = chartData?.chart?.result?.[0]?.indicators?.quote?.[0];
          if (quotes && quotes.close && quotes.close.length > 0) {
            currentPrice = quotes.close[quotes.close.length - 1];
          }
        }
      } catch {
        /* current price is best-effort */
      }
    }
    return {
      success: true,
      ticker: upperTicker,
      currentPrice: currentPrice || 0,
      technical: {
        shortTerm: tech.shortTermOutlook?.direction || null,
        midTerm: tech.intermediateTermOutlook?.direction || null,
        longTerm: tech.longTermOutlook?.direction || null,
      },
      valuation: val.description || null,
      discount: val.discount || null,
      support: key.support || null,
      resistance: key.resistance || null,
      rating: rec.rating || null,
      targetPrice: rec.targetPrice || null,
      latestNews: sigDevs[0]?.headline || null,
      timestamp: new Date().toISOString(),
    };
  }

  const company = result.companySnapshot?.company || {};
  const upsell = result.upsell || {};
  const reports = result.reports || [];
  let price = 0;
  if (chartRes.ok) {
    const chartData = await chartRes.json();
    price = chartData?.chart?.result?.[0]?.meta?.regularMarketPrice || 0;
  }
  return {
    success: true,
    ticker: upperTicker,
    price,
    target: null,
    upside: null,
    rating: rec.rating || null,
    provider: rec.provider || null,
    technical: {
      short: {
        direction: tech.shortTermOutlook?.direction || null,
        score: tech.shortTermOutlook?.score || null,
        desc: tech.shortTermOutlook?.scoreDescription || null,
      },
      mid: {
        direction: tech.intermediateTermOutlook?.direction || null,
        score: tech.intermediateTermOutlook?.score || null,
        desc: tech.intermediateTermOutlook?.scoreDescription || null,
      },
      long: {
        direction: tech.longTermOutlook?.direction || null,
        score: tech.longTermOutlook?.score || null,
        desc: tech.longTermOutlook?.scoreDescription || null,
      },
      vsSector: tech.shortTermOutlook?.sectorDirection || null,
      vsIndex: tech.shortTermOutlook?.indexDirection || null,
    },
    levels: {
      support: key.support || null,
      resistance: key.resistance || null,
      stopLoss: key.stopLoss ? parseFloat(key.stopLoss.toFixed(2)) : null,
    },
    valuation: {
      status: val.description || null,
      discount: val.discount || null,
    },
    scores: {
      innovativeness: company.innovativeness || null,
      hiring: company.hiring || null,
      sustainability: company.sustainability || null,
      insiderSentiments: company.insiderSentiments || null,
      earningsReports: company.earningsReports || null,
      dividends: company.dividends || null,
    },
    bullish: Array.isArray(upsell.msBullishSummary) ? upsell.msBullishSummary.slice(0, 3) : [],
    bearish: Array.isArray(upsell.msBearishSummary) ? upsell.msBearishSummary.slice(0, 3) : [],
    news: sigDevs[0] ? { headline: sigDevs[0].headline, date: sigDevs[0].date } : null,
    reports: Array.isArray(reports)
      ? reports.slice(0, 2).map((r: any) => ({ title: r.headHtml || null, provider: r.provider || null, date: r.reportDate || null }))
      : [],
    sector: result.companySnapshot?.sectorInfo || null,
  };
}

// ── LLM-prompt simplifiers (colocated with their fetch services) ─────────────
// Extracted verbatim from generator.simplifyApiData — no behavior change. The
// STOCK_PRICE case formerly assigned to an outer `simplified[source]` closure;
// it now plainly returns the same object (the registry loop assigns it).

export function simplifyStockPrice(data: any): any {
  const cp = data.currentPrice;
  const currentPriceValue = typeof cp === "object" ? cp.price : cp;
  const changeValue = typeof cp === "object" ? cp.change : data.change;
  const changePercentValue = typeof cp === "object" ? cp.changePercent : data.changePercent;
  const previousClose = typeof cp === "object" ? cp.previousClose : data.previousClose;
  // Live shape (shared/stockPrice): chartData[{t: epoch ms, c: close, v: volume}].
  // The old code read historicalData/{date,close,volume} — fields that don't exist
  // — so recentStats/recentSamples were always empty.
  const hist = Array.isArray(data.chartData) ? data.chartData : [];
  const recentData = hist
    .slice(-10)
    .map((h: any) => ({ time: typeof h.t === "number" ? new Date(h.t).toISOString() : h.t, close: h.c, volume: h.v }));
  let stats = null;
  if (recentData.length > 0) {
    const closes = recentData.map((r: any) => Number(r.close)).filter(Boolean);
    const volumes = recentData.map((r: any) => Number(r.volume) || 0);
    const dailyMoves = closes.slice(1).map((c: number, i: number) =>
      Math.abs((c - closes[i]) / closes[i]) * 100
    );
    stats = {
      recentHigh: Math.max(...closes).toFixed(2),
      recentLow: Math.min(...closes).toFixed(2),
      avgClose: (closes.reduce((s: number, v: number) => s + v, 0) / closes.length).toFixed(2),
      totalVolume: volumes.reduce((s: number, v: number) => s + v, 0),
      avgDailyMovePct: dailyMoves.length > 0
        ? (dailyMoves.reduce((s: number, v: number) => s + v, 0) / dailyMoves.length).toFixed(2) + "%"
        : null,
      maxDailyMovePct: dailyMoves.length > 0
        ? Math.max(...dailyMoves).toFixed(2) + "%"
        : null,
    };
  }
  return {
    ticker: data.ticker,
    currency: data.currency,
    exchange: data.exchangeName,
    currentPrice: currentPriceValue,
    change: changeValue,
    changePercent: changePercentValue,
    previousClose,
    dayRange: data.dayRange,
    fiftyTwoWeekRange: data.fiftyTwoWeekRange,
    marketState: data.marketState,
    volume: data.volume,
    recentStats: stats,
    recentSamples: recentData,
  };
}

/**
 * Curated LLM projection of the rich analyst-RATING response (shared/rating
 * contract). The OLD body read the legacy shape (data.targetPrice / data.valuation
 * as a string / data.discount / data.support / data.consensus) — paths the rich
 * card never emits — so the LLM got 6 undefined fields while the card formatter,
 * already on the rich shape, rendered fine. This reads the real nested paths
 * (levels.* / valuation.{status,discount} / news.headline) and adds the headline
 * price/target/upside + the analyst bull/bear cases. Mirrors simplifyStockPicker:
 * a small, well-named summary, not a raw dump.
 */
export function simplifyRating(data: any): any {
  const round2 = (v: unknown): number | null =>
    typeof v === "number" && Number.isFinite(v) ? Math.round(v * 100) / 100 : null;
  const tech = data?.technical ?? {};
  const lv = data?.levels ?? {};
  const val = data?.valuation ?? {};
  return {
    ticker: data?.ticker,
    rating: data?.rating ?? null, // "HOLD" | "BUY" | "SELL" — headline
    price: round2(data?.price),
    target: round2(data?.target), // currently null upstream (service.ts L190)
    upside:
      typeof data?.upside === "number" ? `${Math.round(data.upside * 10) / 10}%` : null,
    provider: data?.provider ?? null,
    sector: data?.sector ?? null,
    valuation: { status: val.status ?? null, discount: val.discount ?? null },
    levels: { support: round2(lv.support), resistance: round2(lv.resistance), stopLoss: round2(lv.stopLoss) },
    technical: {
      short: tech.short?.direction ?? null,
      mid: tech.mid?.direction ?? null,
      long: tech.long?.direction ?? null,
      vsSector: tech.vsSector ?? null,
      vsIndex: tech.vsIndex ?? null,
    },
    bullish: Array.isArray(data?.bullish) ? data.bullish.slice(0, 3) : undefined,
    bearish: Array.isArray(data?.bearish) ? data.bearish.slice(0, 3) : undefined,
    latestNews: data?.news?.headline ?? null,
  };
}

export function simplifyPeerStocks(data: any): any {
  return { ticker: data.ticker, similarStocks: data.similarStocks, count: data.count };
}
