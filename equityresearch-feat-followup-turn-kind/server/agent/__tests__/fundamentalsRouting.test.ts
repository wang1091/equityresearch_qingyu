import { describe, it, expect } from "vitest";
import { hasHistoricalFundamentalsModifier } from "../classifier/fundamentalsRouting";

// Only TIME is detected in TS (the authority — LLM is unreliable at dates). Operating-KPI and
// qualitative routing are the LLM's job (prompt rules), deliberately NOT re-judged here.
describe("hasHistoricalFundamentalsModifier — non-latest / multi-period / dated / trailing", () => {
  for (const q of [
    "Apple revenue over the last 3 years",
    "Apple Q2 2023 revenue",
    "revenue since 2020",
    "how has Costco revenue grown over 5 years",
    "fiscal 2022 net income",
    "YoY revenue growth",
    "历史营收",
    "过去几年的利润率",
    "MSFT operating margin history",
    "英伟达的毛利率走势",
    "AMD 的 TTM 自由现金流",
    "NVDA 营收这几季怎么变",
    "Microsoft Q4 EPS", // named quarter = specific period
    "特斯拉第二季度营收和利润",
  ]) it(`historical: ${q}`, () => expect(hasHistoricalFundamentalsModifier(q)).toBe(true));

  // Latest / current / RELATIVE "last quarter" (= latest) / no-period → PERFORMANCE territory.
  for (const q of [
    "Apple latest quarter revenue",
    "Apple gross margin",
    "current revenue",
    "Apple net income",
    "what was AAPL's net income last quarter?",
    // NOT time → these route by the LLM (KPI / qualitative), never by this TS detector:
    "how many paid members does Costco have",
    "is Tesla cash flow sustainable",
  ]) it(`not historical: ${q}`, () => expect(hasHistoricalFundamentalsModifier(q)).toBe(false));
});
