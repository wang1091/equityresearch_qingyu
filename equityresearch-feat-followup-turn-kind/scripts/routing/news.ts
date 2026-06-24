/** NEWS routing cases. Run: npx tsx scripts/routing/run.ts news
 *
 * Real-time news / catalysts / "why did it move". For price-move and overview
 * questions NEWS is the *primary* even when STOCK_PRICE / PERFORMANCE ride
 * along as secondary sources. */
import type { Suite } from "./harness";

export const newsSuite: Suite = {
  name: "news",
  cases: [
    // ── guardrails: prompt-exemplified ──
    { query: "英伟达为什么涨了?", tier: "guardrail", expect: { primary: "NEWS", tickers: ["NVDA"] }, note: "price-move explanation → NEWS primary" },
    { query: "苹果最近怎么样?", tier: "guardrail", expect: { primaryOneOf: ["NEWS", "PERFORMANCE", "STOCK_PRICE"], tickers: ["AAPL"] }, note: "company overview → NEWS primary" },
    { query: "特斯拉最近怎么样?", tier: "guardrail", expect: { primaryOneOf: ["NEWS", "PERFORMANCE", "STOCK_PRICE"], tickers: ["TSLA"] } },

    // ── targets: paraphrases / zh variants ──
    { query: "latest news on TSLA", tier: "target", expect: { primary: "NEWS", tickers: ["TSLA"] } },
    { query: "what happened to PLTR this week?", tier: "target", expect: { primary: "NEWS", tickers: ["PLTR"] } },
    { query: "Why did the AMD stock plunge?", tier: "target", expect: { primary: "NEWS", tickers: ["AMD"] } },
    { query: "英伟达有什么最新消息?", tier: "target", expect: { primary: "NEWS", tickers: ["NVDA"] } },
  ],
};
