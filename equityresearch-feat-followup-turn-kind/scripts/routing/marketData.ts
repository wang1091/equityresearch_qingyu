/** MARKET_DATA routing cases. Run: npx tsx scripts/routing/run.ts marketdata
 *
 * Live metrics + return math: market cap, P/E, EV/EBITDA, YTD / total return,
 * "$X invested", trading volume, multi-ticker return comparison. Overlaps with
 * STOCK_PRICE on "volume / market cap" — the prompt routes those phrasings here. */
import type { Suite } from "./harness";

export const marketDataSuite: Suite = {
  name: "marketdata",
  cases: [
    // ── guardrails: prompt-exemplified ──
    { query: "What is NVDA's market cap?", tier: "guardrail", expect: { primary: "MARKET_DATA", tickers: ["NVDA"] } },
    { query: "What is META's current P/E ratio?", tier: "guardrail", expect: { primary: "MARKET_DATA", tickers: ["META"] } },
    { query: "Compare AAPL and MSFT YTD returns", tier: "guardrail", expect: { primary: "MARKET_DATA", tickers: ["AAPL", "MSFT"] } },
    { query: "What would $10,000 invested in AMZN 5 years ago be worth today?", tier: "guardrail", expect: { primary: "MARKET_DATA", tickers: ["AMZN"] } },
    { query: "What is PLTR's trading volume today?", tier: "guardrail", expect: { primary: "MARKET_DATA", tickers: ["PLTR"] } },

    // ── targets: paraphrases / zh variants ──
    { query: "TSLA 的市值是多少?", tier: "target", expect: { primary: "MARKET_DATA", tickers: ["TSLA"] } },
    { query: "what's AMD's EV/EBITDA?", tier: "target", expect: { primary: "MARKET_DATA", tickers: ["AMD"] } },

    // ── guardrails: ownership de-dup, METRIC OWNERSHIP rule (docs/DATA_SOURCE_OWNERSHIP.md) ──
    // P/E history is price-derived → MARKET_DATA, NOT PERFORMANCE (whose Contains
    // used to declare "P/E history" — removed). Was flaky before the rule.
    { query: "show me NVDA's P/E history", tier: "guardrail", expect: { primary: "MARKET_DATA", tickers: ["NVDA"] }, note: "P/E history price-derived → MARKET_DATA, not PERFORMANCE" },
    { query: "AAPL P/E ratio over the past 5 years", tier: "guardrail", expect: { primary: "MARKET_DATA", tickers: ["AAPL"] } },
    { query: "英伟达的市盈率历史走势", tier: "guardrail", expect: { primary: "MARKET_DATA", tickers: ["NVDA"] } },
    // Peer multiples (P/E vs peers) → MARKET_DATA, NOT VALUATION (whose Contains
    // used to declare "peer multiples (P/E…)" — removed) and not PERFORMANCE (fundamentals only).
    { query: "compare AMD and NVDA P/E", tier: "guardrail", expect: { primary: "MARKET_DATA", tickers: ["AMD", "NVDA"] }, note: "peer multiple comparison → MARKET_DATA" },
    { query: "how does TSLA's P/E compare to its peers?", tier: "guardrail", expect: { primary: "MARKET_DATA", tickers: ["TSLA"] } },

    // ── G2: windowed / historical price RETURN → MARKET_DATA (docs/DATA_SOURCE_OWNERSHIP.md G2) ──
    // Quote-level "price today / change today" → STOCK_PRICE (see stockPrice.ts);
    // any window'd or historical return lives here, NOT STOCK_PRICE.
    { query: "TSLA 6-month return", tier: "guardrail", expect: { primary: "MARKET_DATA", tickers: ["TSLA"] }, note: "windowed return → MARKET_DATA, not STOCK_PRICE" },
    { query: "NVDA total return since 2020", tier: "guardrail", expect: { primary: "MARKET_DATA", tickers: ["NVDA"] } },
    { query: "苹果过去一年的回报率", tier: "guardrail", expect: { primary: "MARKET_DATA", tickers: ["AAPL"] } },
    // "performed over <window>" is genuinely ambiguous (price-return vs business
    // performance) — accept either, just not STOCK_PRICE.
    { query: "how has TSLA performed over the past year?", tier: "target", expect: { primaryOneOf: ["MARKET_DATA", "PERFORMANCE"], tickers: ["TSLA"] } },
  ],
};
