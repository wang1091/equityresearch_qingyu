// Unit net for formatHistoryAsText — the shared "flatten conversation turns into
// a labeled text block" primitive used by the classifier (userOnly + truncate)
// and the Follow-Up Engine. Pure function, so this is exhaustive and offline.
// See docs/LLM_HISTORY_CONTEXT_PLAN.md (B1).
import { describe, it, expect } from "vitest";
import { formatHistoryAsText } from "../../llm/history";

const EN = { user: "User", assistant: "Assistant" } as const;

describe("formatHistoryAsText", () => {
  it("labels each turn and joins with newlines", () => {
    const out = formatHistoryAsText(
      [
        { role: "user", content: "is NVDA a buy?" },
        { role: "assistant", content: "it depends on valuation" },
      ],
      { labels: EN },
    );
    expect(out).toBe("User: is NVDA a buy?\nAssistant: it depends on valuation");
  });

  it("honors custom labels (e.g. follow-ups uses Agent)", () => {
    const out = formatHistoryAsText(
      [{ role: "assistant", content: "hi" }],
      { labels: { user: "User", assistant: "Agent" } },
    );
    expect(out).toBe("Agent: hi");
  });

  it("drops assistant turns when userOnly is set", () => {
    const out = formatHistoryAsText(
      [
        { role: "user", content: "tell me about TSLA" },
        { role: "assistant", content: "Tesla is an EV maker ..." },
        { role: "user", content: "what about its valuation?" },
      ],
      { labels: EN, userOnly: true },
    );
    expect(out).toBe("User: tell me about TSLA\nUser: what about its valuation?");
    expect(out).not.toContain("Assistant:");
  });

  it("truncates each turn's content to maxChars", () => {
    const long = "HEAD" + "z".repeat(500) + "TAIL";
    const out = formatHistoryAsText([{ role: "user", content: long }], {
      labels: EN,
      maxChars: 200,
    });
    expect(out.startsWith("User: HEAD")).toBe(true);
    expect(out).not.toContain("TAIL");
    // label + ": " + 200 chars of content
    expect(out.length).toBe("User: ".length + 200);
  });

  it("returns empty string for empty history", () => {
    expect(formatHistoryAsText([], { labels: EN })).toBe("");
  });

  it("returns empty string when userOnly filters everything out", () => {
    const out = formatHistoryAsText(
      [{ role: "assistant", content: "only an answer" }],
      { labels: EN, userOnly: true },
    );
    expect(out).toBe("");
  });
});
