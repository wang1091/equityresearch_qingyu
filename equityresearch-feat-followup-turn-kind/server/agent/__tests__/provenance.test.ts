// Unit tests for the fused-answer source registry (minimal phase: NEWS links +
// default data chips). See docs/FUSED_ANSWER_SOURCE_ATTRIBUTION_PLAN.md.
import { describe, it, expect } from "vitest";
import { buildSources, buildCitedData, buildNewsArticleLinks, enrichNewsCitations, type LinkSource, type ModelSource, type DataSourceRef } from "../provenance";

describe("buildSources — NEWS provenance (link type)", () => {
  it("extracts clickable links from items[] and sources[], deduped by url", () => {
    const sources = buildSources({
      NEWS: {
        items: [
          { headline: "A", publisher: "Reuters", url: "https://reuters.com/a", date: "2026-06-20" },
          { headline: "B", publisher: "Bloomberg", url: "https://www.bloomberg.com/b" },
        ],
        sources: [
          { publisher: "Reuters", url: "https://reuters.com/a" }, // dup of items[0]
          { publisher: "WSJ", url: "https://wsj.com/c" },
        ],
      },
    });

    expect(sources.every((s) => s.type === "link")).toBe(true);
    const links = sources as LinkSource[];
    expect(links.map((s) => s.url)).toEqual([
      "https://reuters.com/a",
      "https://www.bloomberg.com/b",
      "https://wsj.com/c",
    ]);
    expect(links[0]).toMatchObject({ provider: "NEWS", publisher: "Reuters" });
  });

  it("carries each item's own headline/date as the link title (same-object, can't mislabel)", () => {
    const sources = buildSources({
      NEWS: {
        items: [{ headline: "Reuters scoop", publisher: "Reuters", url: "https://reuters.com/a", date: "2026-06-20" }],
        sources: [{ publisher: "WSJ", url: "https://wsj.com/c" }], // bare search link → no title
      },
    }) as LinkSource[];
    expect(sources.find((s) => s.url === "https://reuters.com/a")).toMatchObject({ title: "Reuters scoop", date: "2026-06-20" });
    expect(sources.find((s) => s.url === "https://wsj.com/c")?.title).toBeUndefined();
  });

  it("drops a publisher label that does not match the URL host (no lying chips)", () => {
    // The news adapter pairs article publishers with index-matched search-result
    // URLs, so a "Bloomberg" label can sit on a cnbc.com link — drop the label.
    const sources = buildSources({
      NEWS: {
        items: [
          { headline: "mismatch", publisher: "Bloomberg", url: "https://cnbc.com/x" },
          { headline: "match", publisher: "Reuters", url: "https://reuters.com/y" },
        ],
      },
    });
    const links = sources as LinkSource[];
    expect(links.find((s) => s.url === "https://cnbc.com/x")?.publisher).toBeUndefined();
    expect(links.find((s) => s.url === "https://reuters.com/y")?.publisher).toBe("Reuters");
  });

  it("drops non-http urls and empty ones", () => {
    const sources = buildSources({
      NEWS: {
        items: [
          { headline: "bad", url: "javascript:alert(1)" },
          { headline: "empty", url: "" },
          { headline: "ok", url: "https://example.com/x" },
        ],
      },
    });
    expect(sources).toHaveLength(1);
    expect((sources[0] as LinkSource).url).toBe("https://example.com/x");
  });
});

describe("buildSources — default provenance (data type)", () => {
  it("emits one provider chip with ticker + an ISO asOf timestamp", () => {
    const before = Date.now();
    const sources = buildSources({ RATING: { ticker: "TSLA", recommendation: "BUY" } });
    expect(sources).toHaveLength(1);
    const s = sources[0] as DataSourceRef;
    expect(s).toMatchObject({ type: "data", provider: "RATING", ticker: "TSLA" });
    expect(Date.parse(s.asOf)).toBeGreaterThanOrEqual(before);
  });

  it("falls back to a null ticker when the payload has none", () => {
    const sources = buildSources({ TRENDING: { gainers: [] } });
    expect(sources[0]).toMatchObject({ type: "data", provider: "TRENDING", ticker: null });
  });
});

describe("buildSources — model provenance", () => {
  it("VALUATION → model with engine + chosen method", () => {
    const sources = buildSources({ VALUATION: { ticker: "NVDA", method: "DCF", verdict: "OVERVALUED" } });
    expect(sources[0]).toMatchObject({
      type: "model",
      provider: "VALUATION",
      ticker: "NVDA",
      engine: "Valuation model",
      method: "DCF",
    });
  });

  it("VALUATION → model omits method when absent", () => {
    const sources = buildSources({ VALUATION: { ticker: "NVDA" } });
    expect((sources[0] as ModelSource).method).toBeUndefined();
  });

  it("COMPETITIVE → model, ticker taken from `company`", () => {
    const sources = buildSources({ COMPETITIVE: { company: "NVDA", industry: "Semis" } });
    expect(sources[0]).toMatchObject({
      type: "model",
      provider: "COMPETITIVE",
      ticker: "NVDA",
      engine: "Porter's Five Forces",
    });
  });

  it("EARNINGS falls back to a data chip (no reliable URL)", () => {
    const sources = buildSources({ EARNINGS: { topic: "calendar", date: "2026-06-21" } });
    expect(sources[0]).toMatchObject({ type: "data", provider: "EARNINGS" });
  });
});

describe("buildNewsArticleLinks — full article list from raw search_results", () => {
  it("keeps title/url/publisher/date aligned per object, dedupes, drops non-http", () => {
    const links = buildNewsArticleLinks({
      search_results: [
        { title: "A headline", url: "https://reuters.com/a", publisher: "Reuters", date: "2026-06-20" },
        { title: "B", url: "https://reuters.com/a" }, // dup url
        { title: "bad", url: "javascript:alert(1)" },
        { title: "C", url: "https://wsj.com/c", source: "WSJ" },
      ],
    });
    expect(links.map((l) => l.url)).toEqual(["https://reuters.com/a", "https://wsj.com/c"]);
    expect(links[0]).toMatchObject({ type: "link", provider: "NEWS", title: "A headline", publisher: "Reuters", date: "2026-06-20" });
    expect(links[1]).toMatchObject({ title: "C", publisher: "WSJ" });
  });

  it("flattens array payloads and tolerates missing search_results", () => {
    expect(buildNewsArticleLinks([{ search_results: [{ url: "https://a.com/x" }] }, {}])).toHaveLength(1);
    expect(buildNewsArticleLinks({ content: {} })).toEqual([]);
  });
});

describe("buildSources — ids for card-backed sources", () => {
  it("assigns unique ids to model/data sources and none to links", () => {
    const sources = buildSources({
      NEWS: { items: [{ url: "https://reuters.com/a", publisher: "Reuters" }] },
      VALUATION: { ticker: "NVDA", method: "DCF" },
      RATING: { ticker: "NVDA" },
    });
    const ids = sources
      .filter((s): s is ModelSource | DataSourceRef => s.type !== "link")
      .map((s) => s.id);
    expect(ids).toEqual(["src1", "src2"]);
    expect(new Set(ids).size).toBe(ids.length);
    // link sources carry no id field
    expect(sources.find((s) => s.type === "link")).not.toHaveProperty("id");
  });
});

describe("buildCitedData — numbered citations + tagged prompt blocks", () => {
  it("numbers one citation per (source, ticker) block and tags the prompt blocks", () => {
    const { citations, promptBlocks } = buildCitedData({
      NEWS: { items: [{ url: "https://reuters.com/a", publisher: "Reuters" }] },
      VALUATION: [{ ticker: "NVDA", method: "DCF" }, { ticker: "AMD" }],
    });
    expect(citations.map((c) => `${c.id}:${c.label}`)).toEqual([
      "S1:NEWS",
      "S2:VALUATION (NVDA)",
      "S3:VALUATION (AMD)",
    ]);
    expect(promptBlocks).toContain("【NEWS | cite=S1】");
    expect(promptBlocks).toContain("【VALUATION (NVDA) | cite=S2】");
    // NEWS citation resolves to its link sources
    expect(citations[0].sources[0]).toMatchObject({ type: "link", url: "https://reuters.com/a" });
  });

  it("feeds a citable-source-less block to the prompt without a cite id", () => {
    // A NEWS block with no usable URLs yields no citation but its data still ships.
    const { citations, promptBlocks } = buildCitedData({ NEWS: { summary: "no links here", items: [] } });
    expect(citations).toHaveLength(0);
    expect(promptBlocks).toContain("【NEWS】");
    expect(promptBlocks).not.toContain("cite=");
  });
});

describe("enrichNewsCitations — cited URLs stay = what the LLM was fed", () => {
  // The simplified NEWS block (capped items[]+sources[]) is what the LLM sees and
  // cites; the raw payload's search_results is a WIDER pool. The footer/inline link
  // must reflect only the former. These pin that invariant against the old B2 bug
  // (which replaced citation.sources with the full raw list).
  const citedFromSimplified = () =>
    buildCitedData({
      // simplified NEWS = only these two articles were fed to the LLM
      NEWS: {
        items: [{ headline: "Used A", publisher: "Reuters", url: "https://reuters.com/a" }],
        sources: [{ publisher: "WSJ", url: "https://wsj.com/c" }],
      },
      VALUATION: { ticker: "NVDA", method: "DCF" },
    }).citations;

  it("does NOT leak raw search_results URLs the answer never used", () => {
    const raw = {
      search_results: [
        { title: "Used A — full title", url: "https://reuters.com/a", publisher: "Reuters" },
        { title: "NEVER FED to the LLM", url: "https://other.com/z", publisher: "Other" },
      ],
    };
    const out = enrichNewsCitations(citedFromSimplified(), raw);
    const news = out.find((c) => c.label === "NEWS")!;
    const urls = (news.sources as LinkSource[]).map((s) => s.url);
    expect(urls).toEqual(["https://reuters.com/a", "https://wsj.com/c"]); // exactly the used set
    expect(urls).not.toContain("https://other.com/z"); // the foreign url is dropped
  });

  it("borrows a title from the raw payload for a same-URL source (titleless search link)", () => {
    const raw = { search_results: [{ title: "WSJ full headline", url: "https://wsj.com/c", publisher: "WSJ" }] };
    const out = enrichNewsCitations(citedFromSimplified(), raw);
    const news = out.find((c) => c.label === "NEWS")!;
    const wsj = (news.sources as LinkSource[]).find((s) => s.url === "https://wsj.com/c")!;
    expect(wsj.title).toBe("WSJ full headline");
  });

  it("keeps an item's own headline title (does not overwrite from raw)", () => {
    const raw = { search_results: [{ title: "raw override", url: "https://reuters.com/a" }] };
    const out = enrichNewsCitations(citedFromSimplified(), raw);
    const news = out.find((c) => c.label === "NEWS")!;
    const a = (news.sources as LinkSource[]).find((s) => s.url === "https://reuters.com/a")!;
    expect(a.title).toBe("Used A"); // the item's own headline wins
  });

  it("leaves non-NEWS citations untouched and is a no-op without raw news", () => {
    const cites = citedFromSimplified();
    expect(enrichNewsCitations(cites, null)).toBe(cites); // no raw → same ref
    const out = enrichNewsCitations(cites, { search_results: [{ url: "https://reuters.com/a" }] });
    expect(out.find((c) => c.label === "VALUATION (NVDA)")).toMatchObject({ id: "S2" });
  });
});

describe("buildSources — multi-ticker fan-out", () => {
  it("expands arrays element-wise, one data chip per (provider, ticker)", () => {
    const sources = buildSources({
      VALUATION: [{ ticker: "TSLA" }, { ticker: "BYDDY" }],
      PERFORMANCE: [{ ticker: "TSLA" }, { ticker: "BYDDY" }],
    });
    expect(sources.map((s) => `${s.provider}:${(s as DataSourceRef).ticker}`)).toEqual([
      "VALUATION:TSLA",
      "VALUATION:BYDDY",
      "PERFORMANCE:TSLA",
      "PERFORMANCE:BYDDY",
    ]);
  });

  it("dedupes identical (provider, ticker) data chips", () => {
    const sources = buildSources({ RATING: [{ ticker: "AAPL" }, { ticker: "AAPL" }] });
    expect(sources).toHaveLength(1);
  });
});
