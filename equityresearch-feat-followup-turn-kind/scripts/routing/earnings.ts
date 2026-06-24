/** EARNINGS routing cases. Run: npx tsx scripts/routing/run.mts earnings
 *
 * Asserts the final tuple (primary, topic, tickers) after the deterministic
 * coerce step (server/earnings/routing) runs on the classifier output. */
import type { Suite } from "./harness";
import { coerceMarketEarningsCalendar } from "../../server/earnings/routing";

export const earningsSuite: Suite = {
  name: "earnings",
  transform: (cls, query) => coerceMarketEarningsCalendar(cls, query),
  cases: [
    { query: "今天有哪些公司发财报?", tier: "guardrail", expect: { primary: "EARNINGS", topic: "calendar", tickers: [] } },
    { query: "who reports earnings tomorrow?", tier: "guardrail", expect: { primary: "EARNINGS", topic: "calendar", tickers: [] } },
    // Market-wide RANGE phrasings → still topic:calendar, no ticker (coerce resolves
    // the week/month/quarter window; the date math is pinned in calendarRange.test.ts).
    { query: "who reports earnings next week?", tier: "guardrail", expect: { primary: "EARNINGS", topic: "calendar", tickers: [] } },
    { query: "这个月有哪些公司发财报?", tier: "guardrail", expect: { primary: "EARNINGS", topic: "calendar", tickers: [] } },
    { query: "which companies report in Q4?", tier: "guardrail", expect: { primary: "EARNINGS", topic: "calendar", tickers: [] } },
    // 7→5 cleanup: `next`/`ask` topics are gone — single-ticker "when" queries now
    // coerce to topic:calendar (with a direction the harness doesn't assert).
    { query: "When is AAPL's next earnings call?", tier: "guardrail", expect: { primary: "EARNINGS", topic: "calendar", tickers: ["AAPL"] } },
    { query: "AAPL Q3 2026 earnings call date", tier: "guardrail", expect: { primary: "EARNINGS", topic: "calendar", tickers: ["AAPL"] } },
    // Single-ticker "last/上次" (direction=past, not asserted by the harness) + a
    // bare schedule request — both fold into the unified calendar topic.
    { query: "when was TSLA's last earnings call?", tier: "guardrail", expect: { primary: "EARNINGS", topic: "calendar", tickers: ["TSLA"] } },
    { query: "英伟达财报日历", tier: "guardrail", expect: { primary: "EARNINGS", topic: "calendar", tickers: ["NVDA"] } },
    { query: "特斯拉Q3财报", tier: "guardrail", expect: { primary: "EARNINGS", topic: "transcript_qa", tickers: ["TSLA"] } },
    { query: "NVDA 2027 Q1 财报摘要卡片", tier: "guardrail", expect: { primary: "EARNINGS", topic: "summary", tickers: ["NVDA"] } },
    { query: "give me NVDA's Q&A section", tier: "guardrail", expect: { primary: "EARNINGS", topic: "qa", tickers: ["NVDA"] } },
    { query: "NVDA 全文逐字稿", tier: "guardrail", expect: { primary: "EARNINGS", topic: "transcript", tickers: ["NVDA"] } },
    { query: "What did NVDA management say about Blackwell guidance?", tier: "guardrail", expect: { primary: "EARNINGS", topic: "transcript_qa", tickers: ["NVDA"] } },
    // A2: period extraction must come from the LLM (asserts year/quarter VALUES,
    // not just topic). These guard the deletion of the year/quarter regex in
    // server/earnings/routing.ts — see docs/LLM_TS_DUPLICATION_INVENTORY.md.
    { query: "What did Apple say about revenue on its Q2 2024 earnings call?", tier: "guardrail", expect: { primary: "EARNINGS", topic: "transcript_qa", tickers: ["AAPL"], year: 2024, quarter: 2 } },
    { query: "Tesla Q3 2025 earnings revenue", tier: "guardrail", expect: { primary: "EARNINGS", topic: "transcript_qa", tickers: ["TSLA"], year: 2025, quarter: 3 } },
    { query: "英伟达2025年第二季度财报", tier: "guardrail", expect: { primary: "EARNINGS", topic: "transcript_qa", tickers: ["NVDA"], year: 2025, quarter: 2 } },
    { query: "苹果2024年第一季度财报电话会说了什么?", tier: "guardrail", expect: { primary: "EARNINGS", topic: "transcript_qa", tickers: ["AAPL"], year: 2024, quarter: 1 } },
    // Quarter-only NL phrasing: LLM pins the quarter, leaves year for the server.
    { query: "What were NVIDIA's Q2 results?", tier: "guardrail", expect: { primary: "EARNINGS", topic: "transcript_qa", tickers: ["NVDA"], quarter: 2 } },
    // A3: specific-metric earnings questions must route transcript_qa (NOT summary)
    // from the LLM directly — guards deletion of the summary→transcript_qa regex
    // upgrade in server/earnings/routingPolicy.ts.
    { query: "How much revenue did NVIDIA report on its latest earnings call?", tier: "guardrail", expect: { primary: "EARNINGS", topic: "transcript_qa", tickers: ["NVDA"] } },
    { query: "苹果最近一次财报电话会上每股收益是多少?", tier: "guardrail", expect: { primary: "EARNINGS", topic: "transcript_qa", tickers: ["AAPL"] } },
    // EARNINGS is only a secondary module here; primary stays NEWS.
    { query: "英伟达为什么涨了?", tier: "guardrail", expect: { primary: "NEWS", tickers: ["NVDA"] } },
    // Multi-ticker comparison → single transcript_qa ask (smartnews resolves both).
    { query: "compare nvidia and amd earnings", tier: "guardrail", expect: { primary: "EARNINGS", topic: "transcript_qa", tickers: ["AMD", "NVDA"] } },
    { query: "compare nvidia and tesla earnings call", tier: "guardrail", expect: { primary: "EARNINGS", topic: "transcript_qa", tickers: ["NVDA", "TSLA"] } },
    // EARNINGS↔PERFORMANCE boundary (docs/DATA_SOURCE_OWNERSHIP.md §跨界口): the
    // "earnings"/"call"/"guidance"/management-commentary framing keeps these EARNINGS
    // even when they reference financial figures. Bare-number counterparts → PERFORMANCE
    // (see performance.ts). Locks the discriminator replacing the "二选一" tie-breaker.
    { query: "Apple Q2 2024 earnings", tier: "guardrail", expect: { primary: "EARNINGS", topic: "transcript_qa", tickers: ["AAPL"] }, note: "'earnings' frames it → EARNINGS, not a bare number" },
    { query: "what did Tesla say about margins on the Q2 call?", tier: "guardrail", expect: { primary: "EARNINGS", topic: "transcript_qa", tickers: ["TSLA"] }, note: "management commentary on a number → EARNINGS" },
    { query: "AAPL guidance for next quarter", tier: "guardrail", expect: { primary: "EARNINGS", topic: "transcript_qa", tickers: ["AAPL"] }, note: "forward guidance → EARNINGS" },
    // Mixed earnings + valuation comparison: the coerce step must NOT collapse to
    // single-intent EARNINGS and drop VALUATION (bug 003). Target tier — depends on
    // the live classifier returning both intents (LLM jitter), but the routing fix
    // guarantees VALUATION survives the coerce once the classifier emits it.
    { query: "AAPL 财报怎么样，跟 MSFT 估值对比", tier: "target", expect: { primaryOneOf: ["EARNINGS", "VALUATION"], tickers: ["AAPL", "MSFT"], requiredIncludes: ["EARNINGS", "VALUATION"] }, note: "multi-intent must keep both EARNINGS and VALUATION" },
  ],
};
