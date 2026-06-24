/** COMPETITIVE routing cases. Run: npx tsx scripts/routing/run.mts competitive
 *
 * Routing layer only — does the classifier pick COMPETITIVE for moat/positioning
 * questions, and NOT for valuation/price lenses? Deep force-band quality is tested
 * separately by scripts/competitive-suite.mts. */
import type { Suite } from "./harness";

export const competitiveSuite: Suite = {
  name: "competitive",
  cases: [
    { query: "特斯拉的竞争力分析", tier: "guardrail", expect: { primary: "COMPETITIVE", tickers: ["TSLA"] } },
    { query: "What is Apple's competitive moat?", tier: "guardrail", expect: { primary: "COMPETITIVE", tickers: ["AAPL"] } },
    { query: "英伟达的护城河有多深?", tier: "guardrail", expect: { primary: "COMPETITIVE", tickers: ["NVDA"] } },
    { query: "Porter's five forces analysis for Tesla", tier: "guardrail", expect: { primary: "COMPETITIVE", tickers: ["TSLA"] } },
    { query: "苹果在行业里的竞争格局", tier: "guardrail", expect: { primary: "COMPETITIVE", tickers: ["AAPL"] } },
    // Guardrails: a named lens must win over a vague "analysis" word.
    { query: "AAPL valuation", tier: "guardrail", expect: { primary: "VALUATION", tickers: ["AAPL"] } },
    { query: "特斯拉股价多少?", tier: "guardrail", expect: { primary: "STOCK_PRICE", tickers: ["TSLA"] } },
  ],
};
