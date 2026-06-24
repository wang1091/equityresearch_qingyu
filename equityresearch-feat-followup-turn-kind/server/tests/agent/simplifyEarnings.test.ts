// Unit net for simplifyEarnings (server/earnings/service.ts) — guards the Phase 3
// fix: the dominant topic:"ask" shape (default transcript_qa + every fallback
// normalizes to it, content in a single `answer` string) had no branch, so it
// fell to the default return which reads `data.data` and dropped the answer.
import { describe, it, expect } from "vitest";
import { simplifyEarnings } from "../../earnings/service";

describe("simplifyEarnings", () => {
  it("preserves the answer for topic:ask (previously dropped entirely)", () => {
    const out = simplifyEarnings({
      topic: "ask",
      ticker: "NVDA",
      year: 2026,
      quarter: "Q4",
      hasAnswer: true,
      source: "web",
      answer: "NVDA reported record data-center revenue of $35B...",
      references: ["r1", "r2", "r3", "r4", "r5", "r6"],
    });
    expect(out.topic).toBe("ask");
    expect(out.answer).toContain("record data-center revenue");
    expect(out.references).toHaveLength(5); // capped at 5
    expect(out.hasAnswer).toBe(true);
  });

  it("caps a very long ask answer at 3000 chars", () => {
    const out = simplifyEarnings({ topic: "ask", answer: "A".repeat(9000) });
    expect((out.answer as string).length).toBe(3000);
  });

  it("still renders summary/qa/transcript sections via the default branch", () => {
    const out = simplifyEarnings({
      topic: "summary",
      ticker: "AAPL",
      data: [
        { heading: "Revenue", bullets: ["b1", "b2", "b3", "b4"] },
        { heading: "Margins", bullets: ["m1"] },
      ],
    });
    expect(out.topic).toBe("summary");
    expect(out.sections).toHaveLength(2);
    expect(out.sections[0].bullets).toHaveLength(3); // capped at 3
  });
});
