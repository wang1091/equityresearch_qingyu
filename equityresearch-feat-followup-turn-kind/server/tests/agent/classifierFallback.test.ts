// Net for the keyword fallback's degraded flag (bug 005, L3). The fallback is
// structurally single-intent; flagging `degraded` lets downstream surface that a
// multi-intent query may have been silently reduced when all LLMs failed.
import { describe, it, expect } from "vitest";
import { buildKeywordFallback } from "../../agent/classifier";

describe("buildKeywordFallback", () => {
  it("marks its result degraded (single-intent keyword guess)", () => {
    const r = buildKeywordFallback("AAPL 财报怎么样，跟 MSFT 估值对比");
    expect(r.degraded).toBe(true);
    // structurally single-intent: only the first matched keyword family survives
    expect(r.required_data).toEqual(["EARNINGS"]);
  });

  it("still flags degraded for the GENERAL no-keyword case", () => {
    const r = buildKeywordFallback("what is a p/e ratio");
    expect(r.degraded).toBe(true);
  });
});
