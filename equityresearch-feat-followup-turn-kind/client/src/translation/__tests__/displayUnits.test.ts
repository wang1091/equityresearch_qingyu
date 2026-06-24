import { describe, it, expect } from "vitest";
import type { Message, NewsV2Data, NewsBriefData } from "@/types";
import { collectDisplayUnits, resolveSourceView } from "../displayUnits";

const baseMessage = (overrides: Partial<Message> = {}): Message => ({
  id: 2,
  content: "",
  sender: "agent",
  timestamp: new Date("2026-01-01T00:00:00Z"),
  ...overrides,
});

describe("resolveSourceView", () => {
  it("prefers contentEn when set, regardless of live content", () => {
    const msg = baseMessage({
      content: "目前显示的中文",
      contentEn: "original english",
      contentZh: "目前显示的中文",
    });
    expect(resolveSourceView(msg).content).toBe("original english");
  });

  it("falls back to contentZh when contentEn is missing", () => {
    const msg = baseMessage({
      content: "translated english",
      contentZh: "原始中文",
    });
    expect(resolveSourceView(msg).content).toBe("原始中文");
  });

  it("falls back to live content when neither side is cached", () => {
    const msg = baseMessage({ content: "live" });
    expect(resolveSourceView(msg).content).toBe("live");
  });
});

describe("collectDisplayUnits — newsData", () => {
  const newsData: NewsV2Data = {
    content: {
      summary: "summary text",
      title: "title text",
      dek: "dek text",
      notes: ["note 1", "note 2"],
      items: [{ headline: "h1", summary: "s1" }],
      sections: [
        { heading: "sec heading", paragraphs: ["p1", "p2"], bullets: ["b1"] },
      ],
    },
    search_results: [
      {
        title: "src title",
        snippet: "src snippet",
        url: "https://example.com/x",
        publisher: "Reuters",
        provider_source_type: "search",
        provenance: "search_results",
        source: "smartnews",
      },
    ],
    citations: ["https://example.com/citation"],
    meta: { model: "gpt-4", source: "smartnews-v2" },
  };

  it("includes every user-visible content text", () => {
    const units = collectDisplayUnits(baseMessage({ newsDataEn: newsData }));
    expect(units).toEqual(
      expect.arrayContaining([
        "summary text",
        "title text",
        "dek text",
        "note 1",
        "note 2",
        "h1",
        "s1",
        "sec heading",
        "p1",
        "p2",
        "b1",
        "src title",
        "src snippet",
      ]),
    );
  });

  it("excludes search_result metadata (publisher/provenance/source/url/provider_source_type)", () => {
    const units = collectDisplayUnits(baseMessage({ newsDataEn: newsData }));
    expect(units).not.toContain("Reuters");
    expect(units).not.toContain("search");
    expect(units).not.toContain("search_results");
    expect(units).not.toContain("smartnews");
    expect(units).not.toContain("https://example.com/x");
  });

  it("excludes top-level newsData metadata (citations/meta)", () => {
    const units = collectDisplayUnits(baseMessage({ newsDataEn: newsData }));
    expect(units).not.toContain("https://example.com/citation");
    expect(units).not.toContain("gpt-4");
    expect(units).not.toContain("smartnews-v2");
  });
});

describe("collectDisplayUnits — briefData", () => {
  const briefData: NewsBriefData = {
    insights: [
      { text: "insight one", source: "Bloomberg" },
      { text: "insight two" },
    ],
    analyses: [{ text: "analysis one", source: "Reuters" }],
  };

  it("includes insight/analysis text", () => {
    const units = collectDisplayUnits(baseMessage({ briefDataEn: briefData }));
    expect(units).toEqual(
      expect.arrayContaining(["insight one", "insight two", "analysis one"]),
    );
  });

  it("excludes the source field", () => {
    const units = collectDisplayUnits(baseMessage({ briefDataEn: briefData }));
    expect(units).not.toContain("Bloomberg");
    expect(units).not.toContain("Reuters");
  });

  it("includes rich SmartNews brief fields", () => {
    const units = collectDisplayUnits(
      baseMessage({
        briefDataEn: {
          insights: [],
          analyses: [],
          newsItems: [
            {
              text: "news item",
              sources: [{ url: "https://example.com/news", title: "News source" }],
            },
          ],
          keySignals: ["key signal"],
          whatMatters: {
            coreDrivers: ["core driver"],
            whyItMatters: "why it matters",
          },
          expectationGap: {
            alreadyPricedIn: "priced in",
            newInformation: "new info",
          },
          historicalInsight: {
            similarCase: "similar case",
            pattern: "structural",
            implication: "historical implication",
          },
          valuationData: {
            verdict: "undervalued",
            recommendation: "buy",
          },
          valuationImpact: {
            driver: "risk",
            duration: "medium term",
            summary: "valuation impact",
          },
          bottomLine: {
            realityCheck: "reality check",
            valuationChange: "valuation change",
            watchNext: "watch next",
          },
          earningsSummary: {
            sentiment: "bullish",
            summary: "earnings summary",
            highlights: ["earnings highlight"],
          },
        },
      }),
    );

    expect(units).toEqual(
      expect.arrayContaining([
        "news item",
        "key signal",
        "core driver",
        "why it matters",
        "priced in",
        "new info",
        "similar case",
        "structural",
        "historical implication",
        "undervalued",
        "buy",
        "risk",
        "medium term",
        "valuation impact",
        "reality check",
        "valuation change",
        "watch next",
        "bullish",
        "earnings summary",
        "earnings highlight",
      ]),
    );
  });
});

describe("collectDisplayUnits — keyInsights / suggestedFollowups / content", () => {
  it("includes plain string entries from arrays", () => {
    const units = collectDisplayUnits(
      baseMessage({
        keyInsightsEn: ["insight A", "insight B"],
        suggestedFollowupsEn: ["follow-up 1"],
        contentEn: "main content",
      }),
    );
    expect(units).toEqual(
      expect.arrayContaining(["insight A", "insight B", "follow-up 1", "main content"]),
    );
  });

  it("trims whitespace and drops empty strings", () => {
    const units = collectDisplayUnits(
      baseMessage({
        keyInsightsEn: ["  spaced  ", "", "   "],
      }),
    );
    expect(units).toContain("spaced");
    expect(units).not.toContain("");
    expect(units).not.toContain("   ");
  });
});
