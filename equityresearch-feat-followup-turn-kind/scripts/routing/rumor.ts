/** RUMOR routing cases. Run: npx tsx scripts/routing/run.ts rumor
 *
 * Fact-checking unverified claims / M&A rumors / "is it true". Tickers are
 * pulled from the claim (uppercase symbols in the query are auto-extracted),
 * so multi-party rumors list both sides. */
import type { Suite } from "./harness";

export const rumorSuite: Suite = {
  name: "rumor",
  cases: [
    // ── guardrails: prompt-exemplified ──
    { query: "rumor check: is Qualcomm going to acquire Intel?", tier: "guardrail", expect: { primary: "RUMOR", tickers: ["INTC", "QCOM"] } },

    // ── targets: paraphrases / zh variants ──
    { query: "is it true that AAPL is acquiring NFLX?", tier: "target", expect: { primary: "RUMOR", tickers: ["AAPL", "NFLX"] } },
    { query: "I heard TSLA might get bought out — is that real?", tier: "target", expect: { primary: "RUMOR", tickers: ["TSLA"] } },
    { query: "谣言：英伟达要收购ARM吗？", tier: "target", expect: { primary: "RUMOR", tickers: ["ARM", "NVDA"] } },
    { query: "传闻 AMD 要被收购，是真的吗？", tier: "target", expect: { primary: "RUMOR", tickers: ["AMD"] } },
  ],
};
