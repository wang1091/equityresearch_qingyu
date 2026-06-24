/** STOCK_PICKER routing cases. Run: npx tsx scripts/routing/run.mts stockpicker */
import type { Suite } from "./harness";

export const stockPickerSuite: Suite = {
  name: "stockpicker",
  cases: [
    // ── guardrails: adding STOCK_PICKER must not steal these ──
    { query: "compare nvidia and amd earnings", tier: "guardrail", expect: { primary: "EARNINGS", tickers: ["AMD", "NVDA"] }, note: "lens=earnings" },
    { query: "特斯拉和比亚迪哪个更值得投资?", tier: "guardrail", expect: { primary: "VALUATION", tickers: ["BYDDY", "TSLA"] }, note: "investment-decision comparison" },
    { query: "Compare AAPL and MSFT YTD returns", tier: "guardrail", expect: { primary: "MARKET_DATA", tickers: ["AAPL", "MSFT"] }, note: "lens=returns" },
    { query: "Show me today's top gainers", tier: "guardrail", expect: { primary: "TRENDING", tickers: [] } },
    { query: "What are the most active stocks today?", tier: "guardrail", expect: { primary: "TRENDING", tickers: [] } },
    { query: "NVDA valuation", tier: "guardrail", expect: { primary: "VALUATION", tickers: ["NVDA"] } },
    { query: "特斯拉最近怎么样?", tier: "guardrail", expect: { primaryOneOf: ["NEWS", "PERFORMANCE", "STOCK_PRICE"], tickers: ["TSLA"] }, note: "Company Overview, not picker" },
    { query: "should I buy AAPL?", tier: "guardrail", expect: { primary: "VALUATION", tickers: ["AAPL"] } },
    { query: "特斯拉的竞争力分析", tier: "guardrail", expect: { primary: "COMPETITIVE", tickers: ["TSLA"] } },

    // ── targets: the routing we want ──
    { query: "compare amd and nvidia", tier: "target", expect: { primary: "STOCK_PICKER", tickers: ["AMD", "NVDA"] }, note: "bare comparison" },
    { query: "compare amd and nvidia earngins", tier: "target", expect: { primary: "EARNINGS", tickers: ["AMD", "NVDA"] }, note: "typo → still earnings" },
    { query: "compare amd and nvidia revenue", tier: "target", expect: { primaryOneOf: ["EARNINGS", "PERFORMANCE"], tickers: ["AMD", "NVDA"] }, note: "financial lens, never garbage picker" },
    { query: "compare amd and nvidia margins", tier: "target", expect: { primaryOneOf: ["PERFORMANCE", "EARNINGS"], tickers: ["AMD", "NVDA"] } },
    { query: "run amd through the stock picker", tier: "target", expect: { primary: "STOCK_PICKER", tickers: ["AMD"] } },
    { query: "用选股器给英伟达打分", tier: "target", expect: { primary: "STOCK_PICKER", tickers: ["NVDA"] } },
    { query: "analyze nvidia stock", tier: "target", expect: { primary: "STOCK_PICKER", tickers: ["NVDA"] }, note: "generic whole-stock analysis" },
    { query: "分析一下英伟达这只股票", tier: "target", expect: { primary: "STOCK_PICKER", tickers: ["NVDA"] } },
    { query: "AAPL", tier: "target", expect: { primary: "STOCK_PICKER", tickers: ["AAPL"] }, note: "bare ticker → scorecard" },
    { query: "which stocks are undervalued right now?", tier: "target", expect: { primary: "STOCK_PICKER", tickers: [] }, note: "screen" },
    { query: "哪些股票现在被低估?", tier: "target", expect: { primary: "STOCK_PICKER", tickers: [] } },
    { query: "score nvidia and pull its latest news", tier: "target", expect: { primary: "STOCK_PICKER", tickers: ["NVDA"] }, note: "composite → primary stays picker" },
  ],
};
