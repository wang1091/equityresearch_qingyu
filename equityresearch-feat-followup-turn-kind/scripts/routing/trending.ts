/** TRENDING routing cases. Run: npx tsx scripts/routing/run.ts trending
 *
 * Market-wide movers: most active / most discussed / top gainers / top losers.
 * No anchor ticker — tickers is always empty. */
import type { Suite } from "./harness";

export const trendingSuite: Suite = {
  name: "trending",
  cases: [
    // ── guardrails: prompt-exemplified ──
    { query: "What are the most active stocks today?", tier: "guardrail", expect: { primary: "TRENDING", tickers: [] } },
    { query: "Show me today's top gainers", tier: "guardrail", expect: { primary: "TRENDING", tickers: [] } },
    { query: "Which stocks are falling the most today?", tier: "guardrail", expect: { primary: "TRENDING", tickers: [] } },
    { query: "今天哪些股票最热门？", tier: "guardrail", expect: { primary: "TRENDING", tickers: [] } },

    // ── targets: paraphrases ──
    { query: "今日市场行情概览", tier: "target", expect: { primary: "TRENDING", tickers: [] } },
    { query: "what's moving the market today?", tier: "target", expect: { primary: "TRENDING", tickers: [] } },
  ],
};
