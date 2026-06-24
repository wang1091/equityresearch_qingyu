/** VALUATION routing cases. Run: npx tsx scripts/routing/run.ts valuation
 *
 * DCF / fair value / intrinsic value / over-undervalued verdict. A pure
 * valuation question is VALUATION-only; an investment-decision question
 * ("should I buy") keeps VALUATION as the *primary* of a multi-source combo. */
import type { Suite } from "./harness";

export const valuationSuite: Suite = {
  name: "valuation",
  cases: [
    // ── guardrails: prompt-exemplified ──
    { query: "NVDA valuation", tier: "guardrail", expect: { primary: "VALUATION", tickers: ["NVDA"] } },
    { query: "cost valuation", tier: "guardrail", expect: { primary: "VALUATION", tickers: ["COST"] }, note: "COST=Costco ticker, not the accounting word" },
    { query: "特斯拉现在能买吗?", tier: "guardrail", expect: { primary: "VALUATION", tickers: ["TSLA"] }, note: "investment decision → VALUATION primary" },
    { query: "should I buy AAPL?", tier: "guardrail", expect: { primary: "VALUATION", tickers: ["AAPL"] } },
    { query: "特斯拉和比亚迪哪个更值得投资?", tier: "guardrail", expect: { primary: "VALUATION", tickers: ["BYDDY", "TSLA"] }, note: "two-name investment comparison" },

    // ── targets: paraphrases / zh variants ──
    { query: "what's the fair value of TSLA?", tier: "target", expect: { primary: "VALUATION", tickers: ["TSLA"] } },
    { query: "is NVDA overvalued?", tier: "target", expect: { primary: "VALUATION", tickers: ["NVDA"] } },
    { query: "苹果的内在价值是多少?", tier: "target", expect: { primary: "VALUATION", tickers: ["AAPL"] } },
    { query: "run a DCF on MSFT", tier: "target", expect: { primary: "VALUATION", tickers: ["MSFT"] } },
    // SpaceX IPO'd 2026-06-12 as NASDAQ:SPCX — name→ticker map teaches the classifier.
    // Key assertion: SpaceX resolves to SPCX as a tradeable stock (no longer GENERAL).
    { query: "should I buy SpaceX?", tier: "target", expect: { primary: "VALUATION", tickers: ["SPCX"] } },
    // "该追吗" (chase it?) stably reads as a bare whole-stock take → STOCK_PICKER,
    // vs "能买吗 / valuation" → VALUATION. Both are valid tradeable-stock routes.
    { query: "我们该追 SpaceX 吗?", tier: "target", expect: { primaryOneOf: ["VALUATION", "STOCK_PICKER"], tickers: ["SPCX"] } },

    // ── guardrails: target-price subject split, METRIC OWNERSHIP rule (docs/DATA_SOURCE_OWNERSHIP.md 裁决2) ──
    // MODEL/DCF-derived target price → VALUATION; analyst price target → RATING
    // (see rating.ts). These two carry an explicit model/DCF subject.
    { query: "what's TSLA's DCF target price?", tier: "guardrail", expect: { primary: "VALUATION", tickers: ["TSLA"] }, note: "model-derived target price → VALUATION" },
    { query: "fair value price target for AAPL based on a DCF", tier: "guardrail", expect: { primary: "VALUATION", tickers: ["AAPL"] } },
  ],
};
