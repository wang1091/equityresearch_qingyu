import { describe, it, expect, vi, beforeEach } from "vitest";
import { copyContent, getMessageCopyContent } from "../messageCopy";
import type { Message } from "@/types";

const baseMsg = (over: Partial<Message>): Message => ({
  id: 2,
  content: "",
  sender: "agent",
  timestamp: new Date(),
  ...over,
});

describe("copyContent", () => {
  let writeText: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    writeText = vi.fn();
    vi.stubGlobal("navigator", { clipboard: { writeText } });
  });

  it("strips HTML and collapses blank runs for full copy", () => {
    copyContent("<p>Hello   world</p>\n\n\n\n<b>x</b>");
    expect(writeText).toHaveBeenCalledWith("Hello world\n\nx");
  });

  it("extracts key_insights when keyInsightsOnly is set", () => {
    copyContent(JSON.stringify({ key_insights: ["a", "b"] }), true);
    expect(writeText).toHaveBeenCalledWith("a\nb");
  });

  it("falls back to full content when key-insights JSON is malformed", () => {
    copyContent("not json", true);
    expect(writeText).toHaveBeenCalledWith("not json");
  });
});

describe("getMessageCopyContent", () => {
  it("prefers raw content", () => {
    expect(getMessageCopyContent(baseMsg({ content: "raw" }), "en")).toBe("raw");
  });

  it("flattens a news payload with a localized sources label", () => {
    const msg = baseMsg({
      newsData: {
        content: { title: "T", summary: "S", items: [{ headline: "H1", summary: "s1" }] },
        search_results: [{ url: "https://x.com" }],
      },
    } as Partial<Message>);
    const out = getMessageCopyContent(msg, "zh");
    expect(out).toContain("T");
    expect(out).toContain("1. H1");
    expect(out).toContain("来源:");
    expect(out).toContain("https://x.com");
  });

  it("returns empty string when there is nothing to copy", () => {
    expect(getMessageCopyContent(baseMsg({}), "en")).toBe("");
  });
});
