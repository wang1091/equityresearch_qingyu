// server/marketData/marketDataService.ts
// FMP (primary) → Yahoo Finance (fallback) provider chain.
// All calculations are programmatic — no LLM estimates used.

import type {
  MarketDataRequest,
  MarketDataResponse,
  MarketDataResult,
  QuoteData,
  HistoricalPoint,
  CalculatedMetrics,
} from "./types";
import { createRequestJson } from "../../http/httpClient";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const FMP_STABLE = "https://financialmodelingprep.com/stable";
const YAHOO_BASE = "https://query2.finance.yahoo.com";
const TIMEOUT_MS = 5000;

const YAHOO_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  "Accept": "application/json",
  "Accept-Language": "en-US,en;q=0.9",
  "Cache-Control": "no-cache",
};

// ---------------------------------------------------------------------------
// Structured logging (no API keys logged)
// ---------------------------------------------------------------------------
type LogEvent =
  | "MARKET_DATA_REQUEST"
  | "MARKET_DATA_FMP_SUCCESS"
  | "MARKET_DATA_FMP_FAILURE"
  | "MARKET_DATA_YAHOO_SUCCESS"
  | "MARKET_DATA_YAHOO_FAILURE"
  | "MARKET_DATA_CALCULATION"
  | "MARKET_DATA_UNAVAILABLE";

function mdLog(event: LogEvent, data?: Record<string, unknown>) {
  console.log(`[MarketData] ${event}`, data ? JSON.stringify(data) : "");
}

function fmtLargeNum(n: number | null | undefined): string | null {
  if (n == null || isNaN(n)) return null;
  if (Math.abs(n) >= 1e12) return `$${(n / 1e12).toFixed(2)}T`;
  if (Math.abs(n) >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (Math.abs(n) >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
  return `$${n.toFixed(0)}`;
}

// ---------------------------------------------------------------------------
// FMP provider
// ---------------------------------------------------------------------------
function getFmpKey(): string {
  const key = process.env.FMP_API_KEY;
  if (!key) throw new Error("FMP_API_KEY is not set");
  return key;
}

// Shared transport for FMP: per-host circuit breaker + retry + structured wire
// logging. The api key is injected by fetchFn at the LAST step, so the URL that
// createRequestJson sees and LOGS never contains the secret. fetch is resolved
// at call time so test stubs are honored.
const fmpRequestJson = createRequestJson<"FMP">({
  fetchFn: (input, init) => {
    const url = new URL(String(input));
    url.searchParams.set("apikey", getFmpKey());
    return fetch(url, init);
  },
});

/** Fetch an FMP /stable endpoint through the shared transport. `endpoint` is the
 *  path + non-secret query (e.g. `profile?symbol=AAPL`); the api key is appended
 *  privately. Returns parsed JSON; throws on transport/HTTP error. Exported so
 *  other FMP consumers (routes/quotes.ts) share one hardened client. */
export async function fmpFetch(endpoint: string): Promise<any> {
  // Clean URL (no apikey) — fmpRequestJson's fetchFn appends the key privately.
  const url = `${FMP_STABLE}/${endpoint}`;
  const endpointName = endpoint.split("?")[0];
  return fmpRequestJson({
    source: "FMP",
    request: { url, endpointName, init: { method: "GET" } },
    policy: {
      timeoutMs: TIMEOUT_MS,
      maxRetries: 1,
      circuitBreaker: true,
      circuitFailureThreshold: 3,
      circuitOpenMs: 30_000,
    },
  });
}

async function fmpQuote(ticker: string): Promise<QuoteData> {
  // Use stable endpoints: quote, key-metrics-ttm, profile
  const [quoteArr, metricsArr, profileArr] = await Promise.allSettled([
    fmpFetch(`quote?symbol=${ticker}`),
    fmpFetch(`key-metrics-ttm?symbol=${ticker}&limit=1`),
    fmpFetch(`profile?symbol=${ticker}`),
  ]);

  const q = quoteArr.status === "fulfilled" ? (quoteArr.value as any[])?.[0] : null;
  const m = metricsArr.status === "fulfilled" ? (metricsArr.value as any[])?.[0] : null;
  const p = profileArr.status === "fulfilled" ? (profileArr.value as any[])?.[0] : null;

  if (!q) throw new Error("FMP quote empty");

  // YTD return from light historical endpoint
  let ytdReturn: number | null = null;
  try {
    const yearStart = `${new Date().getFullYear()}-01-01`;
    const today = new Date().toISOString().split("T")[0];
    const hist = await fmpFetch(`historical-price-eod/light?symbol=${ticker}&from=${yearStart}&to=${today}`) as any[];
    if (Array.isArray(hist) && hist.length >= 2) {
      const oldest = hist[hist.length - 1];
      const newest = hist[0];
      if (oldest?.price && newest?.price) {
        ytdReturn = ((newest.price - oldest.price) / oldest.price) * 100;
      }
    }
  } catch { /* ytd optional */ }

  return {
    ticker: ticker.toUpperCase(),
    price: q.price ?? 0,
    change: q.change ?? 0,
    changePercent: q.changePercentage ?? q.changesPercentage ?? 0,
    previousClose: q.previousClose ?? ((q.price ?? 0) - (q.change ?? 0)),
    open: q.open ?? 0,
    dayHigh: q.dayHigh ?? 0,
    dayLow: q.dayLow ?? 0,
    volume: q.volume ?? 0,
    marketCap: q.marketCap ?? p?.marketCap ?? null,
    sharesOutstanding: p?.sharesOutstanding ?? null,
    pe: m?.peRatioTTM ?? null,
    ps: m?.priceToSalesRatioTTM ?? null,
    evEbitda: m?.evToEBITDATTM ?? m?.enterpriseValueOverEBITDATTM ?? null,
    eps: m?.netIncomePerShareTTM ?? null,
    dividendYield: p?.lastDiv != null && q?.price ? (p.lastDiv / q.price) * 100 : null,
    beta: p?.beta ?? null,
    fiftyTwoWeekHigh: q.yearHigh ?? null,
    fiftyTwoWeekLow: q.yearLow ?? null,
    ytdReturn,
    companyName: q.name ?? p?.companyName ?? ticker,
    sector: p?.sector ?? null,
    currency: p?.currency ?? q.currency ?? "USD",
    exchange: q.exchange ?? q.exchangeShortName ?? "",
    provider: "fmp",
  };
}

async function fmpHistorical(ticker: string, from: string, to: string): Promise<HistoricalPoint[]> {
  // Use light EOD historical endpoint
  const data = await fmpFetch(`historical-price-eod/light?symbol=${ticker}&from=${from}&to=${to}`) as any[];
  if (!Array.isArray(data)) return [];
  return data
    .map((h: any) => ({ date: h.date, close: h.price ?? h.close ?? 0, volume: h.volume ?? 0 }))
    .filter((h) => h.close > 0)
    .sort((a, b) => a.date.localeCompare(b.date));
}

// ---------------------------------------------------------------------------
// Yahoo Finance provider
// ---------------------------------------------------------------------------
async function yahooQuote(ticker: string): Promise<QuoteData> {
  const url = `${YAHOO_BASE}/v8/finance/chart/${ticker}?range=1d&interval=1d&includePrePost=false`;
  const res = await fetch(url, { headers: YAHOO_HEADERS, signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!res.ok) throw new Error(`Yahoo chart ${res.status}`);
  const json = await res.json();
  const result = json.chart?.result?.[0];
  if (!result) throw new Error("Yahoo chart empty");
  const meta = result.meta;
  const price = meta.regularMarketPrice ?? 0;
  const prevClose = meta.chartPreviousClose ?? meta.previousClose ?? 0;

  // Fetch additional modules for P/E, market cap etc.
  let pe: number | null = null;
  let marketCap: number | null = meta.marketCap ?? null;
  let companyName = ticker;
  let dividendYield: number | null = null;
  let fiftyTwoWeekHigh: number | null = null;
  let fiftyTwoWeekLow: number | null = null;
  let beta: number | null = null;
  let sector: string | null = null;
  let sharesOutstanding: number | null = null;
  let eps: number | null = null;

  try {
    const summaryUrl = `${YAHOO_BASE}/v10/finance/quoteSummary/${ticker}?modules=summaryDetail,defaultKeyStatistics,assetProfile,financialData`;
    const summaryRes = await fetch(summaryUrl, { headers: YAHOO_HEADERS, signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (summaryRes.ok) {
      const summaryJson = await summaryRes.json();
      const qsr = summaryJson.quoteSummary?.result?.[0];
      if (qsr) {
        const sd = qsr.summaryDetail || {};
        const ks = qsr.defaultKeyStatistics || {};
        const ap = qsr.assetProfile || {};
        pe = sd.trailingPE?.raw ?? ks.trailingEps?.raw ? (price / ks.trailingEps.raw) : null;
        marketCap = sd.marketCap?.raw ?? marketCap;
        dividendYield = sd.dividendYield?.raw ? sd.dividendYield.raw * 100 : null;
        fiftyTwoWeekHigh = sd.fiftyTwoWeekHigh?.raw ?? null;
        fiftyTwoWeekLow = sd.fiftyTwoWeekLow?.raw ?? null;
        beta = sd.beta?.raw ?? null;
        sector = ap.sector ?? null;
        sharesOutstanding = ks.sharesOutstanding?.raw ?? null;
        eps = ks.trailingEps?.raw ?? null;
        companyName = ap.name ?? ks.enterpriseValue?.fmt ? ticker : ticker;
      }
    }
  } catch { /* summary optional */ }

  return {
    ticker: ticker.toUpperCase(),
    price,
    change: price - prevClose,
    changePercent: prevClose !== 0 ? ((price - prevClose) / prevClose) * 100 : 0,
    previousClose: prevClose,
    open: meta.regularMarketOpen ?? price,
    dayHigh: meta.regularMarketDayHigh ?? price,
    dayLow: meta.regularMarketDayLow ?? price,
    volume: meta.regularMarketVolume ?? 0,
    marketCap,
    sharesOutstanding,
    pe,
    ps: null,
    evEbitda: null,
    eps,
    dividendYield,
    beta,
    fiftyTwoWeekHigh,
    fiftyTwoWeekLow,
    ytdReturn: null,
    companyName,
    sector,
    currency: meta.currency ?? "USD",
    exchange: meta.exchangeName ?? "",
    provider: "yahoo",
  };
}

async function yahooHistorical(ticker: string, from: string, to: string): Promise<HistoricalPoint[]> {
  const fromTs = Math.floor(new Date(from).getTime() / 1000);
  const toTs = Math.floor(new Date(to).getTime() / 1000);
  const url = `${YAHOO_BASE}/v8/finance/chart/${ticker}?period1=${fromTs}&period2=${toTs}&interval=1d`;
  const res = await fetch(url, { headers: YAHOO_HEADERS, signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!res.ok) throw new Error(`Yahoo historical ${res.status}`);
  const json = await res.json();
  const result = json.chart?.result?.[0];
  if (!result) throw new Error("Yahoo historical empty");
  const timestamps: number[] = result.timestamp || [];
  const closes: number[] = result.indicators?.quote?.[0]?.close || [];
  const volumes: number[] = result.indicators?.quote?.[0]?.volume || [];
  return timestamps
    .map((ts, i) => ({
      date: new Date(ts * 1000).toISOString().split("T")[0],
      close: closes[i] ?? 0,
      volume: volumes[i] ?? 0,
    }))
    .filter((p) => p.close > 0)
    .sort((a, b) => a.date.localeCompare(b.date));
}

// ---------------------------------------------------------------------------
// Programmatic calculations (no LLM)
// ---------------------------------------------------------------------------
function calculateMetrics(
  quotes: QuoteData[],
  historical: Record<string, HistoricalPoint[]>,
  request: MarketDataRequest,
  investmentAmount?: number,
): CalculatedMetrics {
  const calc: CalculatedMetrics = {};
  const primary = quotes[0];
  if (!primary) return calc;

  // YTD return
  if (primary.ytdReturn != null) {
    calc.ytdReturnPct = `${primary.ytdReturn >= 0 ? "+" : ""}${primary.ytdReturn.toFixed(2)}%`;
  }

  // Historical total return
  const hist = historical[primary.ticker];
  if (hist && hist.length >= 2) {
    const startClose = hist[0].close;
    const endClose = hist[hist.length - 1].close;
    const totalReturn = ((endClose - startClose) / startClose) * 100;
    calc.totalReturnPct = `${totalReturn >= 0 ? "+" : ""}${totalReturn.toFixed(2)}%`;

    // Hypothetical portfolio value
    if (investmentAmount && investmentAmount > 0) {
      const sharesAcquired = investmentAmount / startClose;
      const currentValue = sharesAcquired * (primary.price || endClose);
      calc.hypotheticalInvested = `$${investmentAmount.toLocaleString()}`;
      calc.hypotheticalValue = `$${currentValue.toFixed(2)} (${currentValue >= investmentAmount ? "+" : ""}${((currentValue - investmentAmount) / investmentAmount * 100).toFixed(2)}%)`;
    }
  }

  // Market cap
  if (primary.marketCap) {
    calc.marketCapFmt = fmtLargeNum(primary.marketCap) ?? undefined;
  }

  // P/E
  if (primary.pe != null) {
    calc.peRatio = `${primary.pe.toFixed(1)}x`;
  }

  // P/S = marketCap / TTM revenue (only if available from FMP key-metrics)
  if (primary.ps != null) {
    calc.psRatio = `${primary.ps.toFixed(1)}x`;
  } else if (primary.marketCap && primary.sharesOutstanding && primary.price) {
    // Cannot derive P/S without revenue — skip
  }

  // EV/EBITDA
  if (primary.evEbitda != null) {
    calc.evEbitdaFmt = `${primary.evEbitda.toFixed(1)}x`;
  }

  // Dividend yield
  if (primary.dividendYield != null) {
    calc.dividendYieldPct = `${primary.dividendYield.toFixed(2)}%`;
  }

  mdLog("MARKET_DATA_CALCULATION", {
    ticker: primary.ticker,
    queryType: request.queryType,
    metrics: Object.keys(calc),
  });

  return calc;
}

// ---------------------------------------------------------------------------
// Fetch quote with FMP → Yahoo fallback
// ---------------------------------------------------------------------------
async function getQuoteWithFallback(ticker: string): Promise<{ quote: QuoteData; provider: "fmp" | "yahoo" }> {
  // Attempt 1: FMP
  try {
    const quote = await fmpQuote(ticker);
    mdLog("MARKET_DATA_FMP_SUCCESS", { ticker });
    return { quote, provider: "fmp" };
  } catch (e) {
    mdLog("MARKET_DATA_FMP_FAILURE", { ticker, reason: e instanceof Error ? e.message : String(e) });
  }

  // Attempt 2: Yahoo Finance
  try {
    const quote = await yahooQuote(ticker);
    mdLog("MARKET_DATA_YAHOO_SUCCESS", { ticker });
    return { quote, provider: "yahoo" };
  } catch (e) {
    mdLog("MARKET_DATA_YAHOO_FAILURE", { ticker, reason: e instanceof Error ? e.message : String(e) });
    throw new Error(`Both providers failed for ${ticker}`);
  }
}

async function getHistoricalWithFallback(
  ticker: string,
  from: string,
  to: string,
): Promise<HistoricalPoint[]> {
  try {
    const hist = await fmpHistorical(ticker, from, to);
    mdLog("MARKET_DATA_FMP_SUCCESS", { ticker, endpoint: "historical", points: hist.length });
    return hist;
  } catch (e) {
    mdLog("MARKET_DATA_FMP_FAILURE", { ticker, endpoint: "historical", reason: e instanceof Error ? e.message : String(e) });
  }
  try {
    const hist = await yahooHistorical(ticker, from, to);
    mdLog("MARKET_DATA_YAHOO_SUCCESS", { ticker, endpoint: "historical", points: hist.length });
    return hist;
  } catch (e) {
    mdLog("MARKET_DATA_YAHOO_FAILURE", { ticker, endpoint: "historical", reason: e instanceof Error ? e.message : String(e) });
    return [];
  }
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------
export async function getMarketData(request: MarketDataRequest): Promise<MarketDataResponse> {
  const { tickers, queryType, fromDate, toDate, question } = request;

  mdLog("MARKET_DATA_REQUEST", {
    tickers,
    queryType,
    fromDate,
    toDate,
    questionLength: question.length,
  });

  if (!tickers.length) {
    return { success: false, error: "MARKET_DATA_UNAVAILABLE", reason: "No tickers provided", tickers: [] };
  }

  try {
    // Fetch all quotes in parallel
    const quoteResults = await Promise.allSettled(tickers.map(getQuoteWithFallback));
    const quotes: QuoteData[] = [];
    const providers = new Set<"fmp" | "yahoo">();

    for (const result of quoteResults) {
      if (result.status === "fulfilled") {
        quotes.push(result.value.quote);
        providers.add(result.value.provider);
      }
    }

    if (quotes.length === 0) {
      mdLog("MARKET_DATA_UNAVAILABLE", { tickers, reason: "all quotes failed" });
      return { success: false, error: "MARKET_DATA_UNAVAILABLE", reason: "All providers failed", tickers };
    }

    // Fetch historical if needed
    const historical: Record<string, HistoricalPoint[]> = {};
    const needsHistorical =
      queryType === "return_calc" ||
      queryType === "portfolio" ||
      queryType === "comparison" ||
      queryType === "historical";

    if (needsHistorical && fromDate && toDate) {
      const histResults = await Promise.allSettled(
        quotes.map((q) => getHistoricalWithFallback(q.ticker, fromDate, toDate).then((h) => ({ ticker: q.ticker, hist: h })))
      );
      for (const r of histResults) {
        if (r.status === "fulfilled" && r.value.hist.length > 0) {
          historical[r.value.ticker] = r.value.hist;
        }
      }
    }

    // Programmatic calculations
    const investmentAmount = request.question.match(/\$\s*([\d,]+(?:\.\d+)?)/)?.[0]
      ? parseFloat(request.question.match(/\$\s*([\d,]+(?:\.\d+)?)/)![1].replace(/,/g, ""))
      : undefined;

    const calculated = calculateMetrics(quotes, historical, request, investmentAmount);

    const provider =
      providers.size === 1
        ? (Array.from(providers)[0] as "fmp" | "yahoo")
        : "mixed";

    const result: MarketDataResult = {
      success: true,
      tickers,
      queryType,
      quotes,
      ...(Object.keys(historical).length > 0 ? { historical } : {}),
      ...(Object.keys(calculated).length > 0 ? { calculated } : {}),
      provider,
      fetchedAt: new Date().toISOString(),
    };

    return result;
  } catch (err) {
    mdLog("MARKET_DATA_UNAVAILABLE", { tickers, reason: err instanceof Error ? err.message : String(err) });
    return {
      success: false,
      error: "MARKET_DATA_UNAVAILABLE",
      reason: err instanceof Error ? err.message : "Unknown error",
      tickers,
    };
  }
}

/** Trim the MARKET_DATA payload for the LLM prompt. Extracted verbatim from
 *  generator.simplifyApiData — no behavior change. */
export function simplifyMarketData(data: any): any {
  if (!data?.success) return { error: "MARKET_DATA_UNAVAILABLE" };
  const quotes = (data.quotes || []).map((q: any) => ({
    ticker: q.ticker,
    companyName: q.companyName,
    price: q.price,
    change: q.change != null ? Number(q.change).toFixed(2) : null,
    changePercent: q.changePercent != null ? Number(q.changePercent).toFixed(2) + "%" : null,
    marketCap: q.marketCap,
    volume: q.volume,
    pe: q.pe != null ? Number(q.pe).toFixed(1) + "x" : null,
    ps: q.ps != null ? Number(q.ps).toFixed(1) + "x" : null,
    evEbitda: q.evEbitda != null ? Number(q.evEbitda).toFixed(1) + "x" : null,
    dividendYield: q.dividendYield != null ? Number(q.dividendYield).toFixed(2) + "%" : null,
    ytdReturn: q.ytdReturn != null ? Number(q.ytdReturn).toFixed(2) + "%" : null,
    fiftyTwoWeekHigh: q.fiftyTwoWeekHigh,
    fiftyTwoWeekLow: q.fiftyTwoWeekLow,
    beta: q.beta,
    sector: q.sector,
    provider: q.provider,
  }));
  return {
    queryType: data.queryType,
    quotes,
    calculated: data.calculated || null,
    provider: data.provider,
    fetchedAt: data.fetchedAt,
  };
}
