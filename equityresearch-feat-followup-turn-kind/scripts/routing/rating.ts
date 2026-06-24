/** RATING routing cases. Run: npx tsx scripts/routing/run.ts rating
 *
 * Wall Street analyst ratings / consensus / upgrades-downgrades. RATING is
 * ticker-required, so every case carries a ticker. "price target" is the
 * genuinely ambiguous edge (RATING vs VALUATION) — expressed with primaryOneOf. */
import type { Suite } from "./harness";

export const ratingSuite: Suite = {
  name: "rating",
  cases: [
    // ── guardrails: prompt-exemplified ──
    { query: "AAPL分析师评级", tier: "guardrail", expect: { primary: "RATING", tickers: ["AAPL"] } },

    // ── targets: paraphrases / zh variants ──
    { query: "analyst rating for TSLA", tier: "target", expect: { primary: "RATING", tickers: ["TSLA"] } },
    { query: "was NVDA upgraded or downgraded recently?", tier: "target", expect: { primary: "RATING", tickers: ["NVDA"] } },
    { query: "what's the Wall Street consensus on MSFT?", tier: "target", expect: { primary: "RATING", tickers: ["MSFT"] } },
    { query: "苹果的机构评级和目标价", tier: "target", expect: { primaryOneOf: ["RATING", "VALUATION"], tickers: ["AAPL"] }, note: "price-target is ambiguous RATING/VALUATION" },
    { query: "分析师给英伟达的评级如何?", tier: "target", expect: { primary: "RATING", tickers: ["NVDA"] } },

    // ── guardrails: target-price subject split, METRIC OWNERSHIP rule (docs/DATA_SOURCE_OWNERSHIP.md 裁决2) ──
    // ANALYST price target → RATING (model/DCF target → VALUATION, see valuation.ts).
    // These carry an explicit analyst/Wall-Street subject.
    { query: "what's the analyst price target for NVDA?", tier: "guardrail", expect: { primary: "RATING", tickers: ["NVDA"] }, note: "analyst price target → RATING" },
    { query: "华尔街给特斯拉的目标价是多少?", tier: "guardrail", expect: { primary: "RATING", tickers: ["TSLA"] }, note: "Wall-Street target price → RATING" },
  ],
};
