// Net for the classifier output zod contract (server/agent/classifier/schema.ts).
// It is LENIENT by design — validates the top-level shape for observability, never
// rejects (api_params stays polymorphic; normalize coerces). See bug 005.
import { describe, it, expect } from "vitest";
import { validateClassifierOutput } from "../../agent/classifier/schema";

describe("validateClassifierOutput", () => {
  it("accepts a well-formed multi-intent classification", () => {
    const r = validateClassifierOutput({
      tickers: ["AAPL", "MSFT"],
      required_data: ["EARNINGS", "VALUATION"],
      primary_focus: "EARNINGS",
      need_api: true,
      confidence: 0.9,
      reasoning: "...",
      api_params: {
        EARNINGS: { ticker: "AAPL", topic: "transcript_qa", question: "AAPL latest earnings" },
        VALUATION: [{ ticker: "AAPL", query: "AAPL vs MSFT valuation" }],
      },
    });
    expect(r.ok).toBe(true);
  });

  it("tolerates extra keys and the polymorphic api_params (passthrough)", () => {
    expect(validateClassifierOutput({
      required_data: ["EARNINGS"],
      api_params: { EARNINGS: { topic: "calendar", date: "2026-06-20" } },
      extra_field: "ignored",
    }).ok).toBe(true);
  });

  it("flags a wrong-typed field (for logging) without throwing", () => {
    const r = validateClassifierOutput({ required_data: "EARNINGS", confidence: "high" });
    expect(r.ok).toBe(false);
    expect(r.issues).toBeTruthy();
    expect(r.issues).toContain("required_data");
  });
});
