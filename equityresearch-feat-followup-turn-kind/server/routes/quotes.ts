/**
 * Express routes for per-ticker market quotes proxied from Yahoo Finance / FMP:
 * /stock-detail/:ticker, /stock-price/:ticker, /similar-stocks/:ticker, and
 * /analyst-ratings/:ticker (+ /detail). Registered on the API router by
 * routes.ts (mirrors registerStockPickerRoutes / etc.). Pure upstream proxies —
 * no app deps beyond console + fetch.
 *
 * Extracted verbatim from routes.ts (per-domain split) — no behavior change;
 * handlers keep their original (col-0) indentation. Behavior pinned by L1
 * (route table) and L2 (routes/quotes.test.ts).
 */
import type { Router } from "express";
import { fmpFetch } from "../marketData/marketDataService";
import {
  fetchStockPrice,
  fetchSimilarStocks,
  fetchAnalystRating,
} from "../quotes/service";

export function registerQuotesRoutes(apiRouter: Router): void {
  // ========== 股票详情 API (包含基本面数据) ==========
apiRouter.get("/stock-detail/:ticker", async (req, res) => {
  console.log("📊 /api/stock-detail called");

  try {
    const { ticker } = req.params;
    const upperTicker = ticker.toUpperCase();

    // Source from FMP (quote + profile + key-metrics-ttm), all through the
    // hardened client (fmpFetch → per-host circuit breaker + retry + wire logs).
    // Replaces the old raw Yahoo quoteSummary v10 fetch, which now requires a
    // crumb/cookie and returns 401 from server IPs (→ 500). FMP covers every
    // field; the metrics/profile legs are best-effort so a quote alone still 200s.
    const [quoteR, profileR, metricsR] = await Promise.allSettled([
      fmpFetch(`quote?symbol=${upperTicker}`),
      fmpFetch(`profile?symbol=${upperTicker}`),
      fmpFetch(`key-metrics-ttm?symbol=${upperTicker}&limit=1`),
    ]);

    const q = quoteR.status === "fulfilled" ? (quoteR.value as any[])?.[0] : null;
    const p = profileR.status === "fulfilled" ? (profileR.value as any[])?.[0] : null;
    const m = metricsR.status === "fulfilled" ? (metricsR.value as any[])?.[0] : null;

    if (!q) {
      throw new Error("No quote data returned from FMP");
    }

    const fmtCap = (n: number | null | undefined): string | null => {
      if (n == null || isNaN(n)) return null;
      const a = Math.abs(n);
      if (a >= 1e12) return `$${(n / 1e12).toFixed(2)}T`;
      if (a >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
      if (a >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
      return `$${n.toFixed(0)}`;
    };
    const marketCap = q.marketCap ?? p?.marketCap ?? null;

    res.json({
      success: true,
      ticker: upperTicker,

      // 基本信息
      name: q.name ?? p?.companyName ?? upperTicker,
      exchange: q.exchange ?? q.exchangeShortName ?? p?.exchangeShortName ?? "N/A",
      currency: p?.currency ?? q.currency ?? "USD",
      marketState: "REGULAR", // FMP has no live market-state flag

      // 当前价格
      currentPrice: {
        price: q.price ?? null,
        change: q.change ?? null,
        changePercent: q.changesPercentage ?? q.changePercentage ?? null,
        previousClose: q.previousClose ?? null,
      },

      // 盘后价格：FMP quote 不提供
      postMarket: null,

      // 日内数据
      dayRange: {
        open: q.open ?? null,
        high: q.dayHigh ?? null,
        low: q.dayLow ?? null,
      },

      // 52周范围
      fiftyTwoWeekRange: {
        high: q.yearHigh ?? null,
        low: q.yearLow ?? null,
      },

      // 成交量
      volume: {
        current: q.volume ?? null,
        average: q.avgVolume ?? null,
        average10Day: null, // not in FMP quote
      },

      // ⭐ 关键基本面数据
      fundamentals: {
        marketCap,
        marketCapFmt: fmtCap(marketCap),

        pe: q.pe ?? m?.peRatioTTM ?? null,         // 市盈率 (TTM)
        forwardPE: null,                            // FMP quote/metrics 不直接提供

        eps: q.eps ?? m?.netIncomePerShareTTM ?? null, // 每股收益

        dividend: p?.lastDiv ?? null,               // 股息
        dividendYield: p?.lastDiv != null && q.price ? (p.lastDiv / q.price) * 100 : null,

        beta: p?.beta ?? null,                      // Beta 系数

        priceToBook: m?.pbRatioTTM ?? m?.priceToBookRatioTTM ?? null, // 市净率
      },

      timestamp: new Date().toISOString(),
    });

  } catch (error) {
    console.error("❌ Stock detail error:", error);
    res.status(500).json({
      success: false,
      error: "Failed to fetch stock detail",
      details: error instanceof Error ? error.message : "Unknown error",
    });
  }
});


// ========== 股价 + 走势图 API (优化版) ==========
apiRouter.get("/stock-price/:ticker", async (req, res) => {
  console.log("📈 /api/stock-price called");

  // Prevent any proxy or browser from caching live price data
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
  res.setHeader("Pragma", "no-cache");

  try {
    const { ticker } = req.params;
    const { range, interval, includeHistory } = req.query;
    const responseData = await fetchStockPrice(ticker, {
      range: typeof range === "string" ? range : undefined,
      interval: typeof interval === "string" ? interval : undefined,
      includeHistory: includeHistory === undefined ? undefined : includeHistory === "true",
    });
    res.json(responseData);
  } catch (error) {
    console.error("❌ Stock price error:", error);
    res.status(500).json({
      success: false,
      error: "Failed to fetch stock price",
      details: error instanceof Error ? error.message : "Unknown error",
    });
  }
});

  // ========== 相似股票推荐 API (Yahoo Finance v6) ==========
  apiRouter.get("/similar-stocks/:ticker", async (req, res) => {
    console.log("🔍 /api/similar-stocks called");

    try {
      const { ticker } = req.params;

      if (!ticker || typeof ticker !== "string") {
        return res.status(400).json({
          success: false,
          error: "Valid ticker symbol is required",
        });
      }

      res.json(await fetchSimilarStocks(ticker));
    } catch (error) {
      console.error("❌ Similar stocks error:", error);
      res.status(500).json({
        success: false,
        error: "Failed to fetch similar stocks",
        details: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });

// ========== 详细版 - 前端展示用 ==========
apiRouter.get("/analyst-ratings/:ticker/detail", async (req, res) => {
  console.log("🎯 /api/analyst-ratings/:ticker/detail called");

  try {
    const { ticker } = req.params;
    if (!ticker) {
      return res.status(400).json({ success: false, error: "Ticker required" });
    }

    res.json(await fetchAnalystRating(ticker, { detail: true }));
  } catch (error) {
    console.error("❌ Error:", error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : "Unknown",
    });
  }
});

// ========== 分析师评级 API (精简版) ==========
apiRouter.get("/analyst-ratings/:ticker", async (req, res) => {
  console.log("🎯 /api/analyst-ratings called");

  try {
    const { ticker } = req.params;
    if (!ticker) {
      return res.status(400).json({ success: false, error: "Ticker required" });
    }

    res.json(await fetchAnalystRating(ticker, { detail: false }));
  } catch (error) {
    console.error("❌ Error:", error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
});
}
