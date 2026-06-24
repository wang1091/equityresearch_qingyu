import { describe, it, expect } from "vitest";
import { deriveAnswerIntent, intentWantsVerdict } from "../answerIntent";

describe("deriveAnswerIntent", () => {
  it("decision: buy/sell-style questions (EN + ZH)", () => {
    expect(deriveAnswerIntent("should I buy NVDA?", {})).toBe("decision");
    expect(deriveAnswerIntent("英伟达现在值得买吗", {})).toBe("decision");
    expect(deriveAnswerIntent("is TSLA overvalued?", {})).toBe("decision");
  });

  it("decision beats comparison when both present", () => {
    expect(deriveAnswerIntent("对比英伟达和AMD，哪个更值得买", { tickers: ["NVDA", "AMD"] })).toBe("decision");
  });

  it("comparison: explicit wording or 2+ tickers", () => {
    expect(deriveAnswerIntent("对比英伟达和AMD", { tickers: ["NVDA", "AMD"] })).toBe("comparison");
    expect(deriveAnswerIntent("NVDA vs AMD", {})).toBe("comparison");
    expect(deriveAnswerIntent("tell me about these two", { tickers: ["NVDA", "AMD"] })).toBe("comparison");
  });

  it("lookup: classifier decided no API needed", () => {
    expect(deriveAnswerIntent("what is a P/E ratio?", { need_api: false })).toBe("lookup");
  });

  it("explainer: data-backed but not a decision/comparison/lookup", () => {
    expect(deriveAnswerIntent("英伟达最近的财务表现怎么样", { need_api: true, tickers: ["NVDA"] })).toBe("explainer");
  });

  it("only decision wants a verdict", () => {
    expect(intentWantsVerdict("decision")).toBe(true);
    expect(intentWantsVerdict("comparison")).toBe(false);
    expect(intentWantsVerdict("explainer")).toBe(false);
    expect(intentWantsVerdict("lookup")).toBe(false);
  });
});
