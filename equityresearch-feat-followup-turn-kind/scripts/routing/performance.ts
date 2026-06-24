/** PERFORMANCE routing cases. Run: npx tsx scripts/routing/run.ts performance
 *
 * Routing rule (docs/DATA_SOURCE_OWNERSHIP.md): PERFORMANCE owns ONLY an exact statement-metric
 * VALUE for the LATEST quarter — revenue, margins, FCF, ROE, debt, income statement, no-time
 * peer comparison. Anything PERFORMANCE can't actually serve reroutes to the EARNINGS
 * transcript_qa RAG (which has the data embedded), via the classifier prompt + the deterministic
 * normalize backstop (server/agent/classifier/fundamentalsRouting.ts):
 *   - operating KPIs (members/subscribers/stores/deliveries…) — not in the statements;
 *   - any NON-latest / multi-period / dated / trailing modifier — PERFORMANCE has no date param;
 *   - qualitative judgments (stable? sustainable? healthy?) — a verdict, not a value.
 * (The earlier "transcript-RAG blind spots → PERFORMANCE" stance was theoretical; in practice
 * PERFORMANCE can't deliver multi-period/computed/qualitative, so those now go to the RAG.) */
import type { Suite } from "./harness";

export const performanceSuite: Suite = {
  name: "performance",
  cases: [
    // ── PERFORMANCE: exact statement-metric VALUE, latest, no time modifier ──
    { query: "what's AAPL's free cash flow?", tier: "target", expect: { primary: "PERFORMANCE", tickers: ["AAPL"] } },
    { query: "特斯拉的现金流和净利润", tier: "target", expect: { primary: "PERFORMANCE", tickers: ["TSLA"] } },
    { query: "INTC 的 EBIT 是多少", tier: "target", expect: { primary: "PERFORMANCE", tickers: ["INTC"] }, note: "precise statement item, no time" },
    // cross-company exact, NO time → PERFORMANCE (it does peers; no time modifier present)
    { query: "AMD 和 INTC 的毛利率谁高?", tier: "target", expect: { primary: "PERFORMANCE", tickers: ["AMD", "INTC"] } },
    { query: "对比 NVDA、AVGO、INTC 的自由现金流", tier: "target", expect: { primary: "PERFORMANCE", tickers: ["NVDA", "AVGO", "INTC"] } },
    // thin/no-transcript names — RAG empty, structured financials still exist, no time → PERFORMANCE
    { query: "Butterfly Network 的自由现金流", tier: "target", expect: { primary: "PERFORMANCE", tickers: ["BFLY"] } },
    { query: "Wolfspeed 的毛利率", tier: "target", expect: { primary: "PERFORMANCE", tickers: ["WOLF"] } },
    // RELATIVE "last quarter" (= the latest) → PERFORMANCE; a NAMED quarter (Q4 / 第二季度) is a
    // specific period PERFORMANCE can't pin → EARNINGS (see the rerouted block below).
    { query: "what was AAPL's net income last quarter?", tier: "guardrail", expect: { primary: "PERFORMANCE", tickers: ["AAPL"] } },

    // revenue/margin lens, no time — PERFORMANCE or EARNINGS both acceptable (never STOCK_PICKER)
    { query: "compare amd and nvidia revenue", tier: "target", expect: { primaryOneOf: ["PERFORMANCE", "EARNINGS"], tickers: ["AMD", "NVDA"] }, note: "revenue lens, never picker" },
    { query: "compare amd and nvidia margins", tier: "target", expect: { primaryOneOf: ["PERFORMANCE", "EARNINGS"], tickers: ["AMD", "NVDA"] } },

    // ── REROUTED to EARNINGS: time-modified / qualitative / KPI (PERFORMANCE can't serve) ──
    // historical / multi-period / trailing → EARNINGS transcript_qa (PERFORMANCE = latest only):
    { query: "show me apple's historical financial data", tier: "guardrail", expect: { primary: "EARNINGS", tickers: ["AAPL"] }, note: "historical → RAG, not latest-quarter PERFORMANCE" },
    { query: "MSFT operating margin history", tier: "target", expect: { primary: "EARNINGS", tickers: ["MSFT"] } },
    { query: "英伟达的毛利率走势", tier: "target", expect: { primary: "EARNINGS", tickers: ["NVDA"] } },
    { query: "NVDA 营收 YoY 增速这几季怎么变的", tier: "target", expect: { primary: "EARNINGS", tickers: ["NVDA"] }, note: "multi-quarter trend → RAG" },
    { query: "AMD 的 TTM 自由现金流是多少", tier: "target", expect: { primary: "EARNINGS", tickers: ["AMD"] }, note: "TTM = trailing window → RAG" },
    { query: "Tesla Q2 2024 revenue", tier: "guardrail", expect: { primary: "EARNINGS", tickers: ["TSLA"] }, note: "specific past period → RAG (PERFORMANCE has no date param)" },
    { query: "Microsoft Q4 EPS", tier: "guardrail", expect: { primary: "EARNINGS", tickers: ["MSFT"] }, note: "named quarter = specific period → RAG" },
    { query: "特斯拉第二季度营收和利润", tier: "guardrail", expect: { primary: "EARNINGS", tickers: ["TSLA"] }, note: "named quarter (第二季度) → RAG" },
    // qualitative judgment about a financial → EARNINGS (a verdict, not a value):
    { query: "NVDA 的自由现金流稳不稳定", tier: "target", expect: { primary: "EARNINGS", tickers: ["NVDA"] } },
  ],
};
