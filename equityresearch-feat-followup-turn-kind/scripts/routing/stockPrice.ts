/** STOCK_PRICE routing cases. Run: npx tsx scripts/routing/run.ts stockprice
 *
 * Live price / change% / volume / day-range lookups. Guards that a bare price
 * question stays STOCK_PRICE and is not stolen by a richer lens (overview,
 * valuation) or by MARKET_DATA (market cap / P-E / returns live there). */
import type { Suite } from "./harness";

export const stockPriceSuite: Suite = {
  name: "stockprice",
  cases: [
    // ── guardrails: prompt-exemplified price lookups ──
    { query: "特斯拉股价多少?", tier: "guardrail", expect: { primary: "STOCK_PRICE", tickers: ["TSLA"] } },
    { query: "What's NVDA trading at right now?", tier: "guardrail", expect: { primary: "STOCK_PRICE", tickers: ["NVDA"] }, note: '"trading at" → price' },

    // ── targets: paraphrases / zh variants ──
    { query: "how much is Apple stock today?", tier: "target", expect: { primary: "STOCK_PRICE", tickers: ["AAPL"] } },
    { query: "AAPL 现在多少钱一股?", tier: "target", expect: { primary: "STOCK_PRICE", tickers: ["AAPL"] } },
    { query: "特斯拉今天涨了多少?", tier: "target", expect: { primary: "STOCK_PRICE", tickers: ["TSLA"] }, note: "change% is still STOCK_PRICE" },
    // G2 boundary: a bare quote stays STOCK_PRICE; windowed/historical RETURN → MARKET_DATA (see marketData.ts).
    { query: "TSLA price today", tier: "guardrail", expect: { primary: "STOCK_PRICE", tickers: ["TSLA"] }, note: "bare quote → STOCK_PRICE, not MARKET_DATA returns" },

    // ── anti-steal guardrails: a named lens must win over the price word ──
    { query: "NVDA valuation", tier: "guardrail", expect: { primary: "VALUATION", tickers: ["NVDA"] }, note: "valuation lens, not price" },
    { query: "苹果最近怎么样?", tier: "guardrail", expect: { primaryOneOf: ["NEWS", "PERFORMANCE", "STOCK_PRICE"], tickers: ["AAPL"] }, note: "overview, not bare price" },
  ],
};
