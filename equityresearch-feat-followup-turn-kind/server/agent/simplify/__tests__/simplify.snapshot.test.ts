// Behavior-lock for the simplifyApiData extraction (Phase 2): the per-source
// trimming logic is being MOVED out of generator.ts into colocated service
// modules + a SIMPLIFY_REGISTRY here, with bodies unchanged. This snapshot net
// captures the output for every card fixture (+ hand-built inputs for the
// stream-only sources NEWS / COMPETITIVE / STOCK_PICKER / PEER_STOCKS that have
// no card fixture) so the move is provably equivalent.
//
// Baseline was captured from the pre-refactor generator.simplifyApiData; after
// the move it is re-pointed at ../index and MUST produce identical snapshots.
// (Phase 3 intentionally changes the PERFORMANCE + EARNINGS-ask snapshots.)
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { simplifyApiData } from "../index";

const FIXTURE_DIR = join(__dirname, "../../__fixtures__/cards");

// Hand-built minimal inputs for sources that stream via onPayload and so have
// no card fixture, but still hit simplifyApiData on the composite-query path.
const SYNTHETIC: Array<{ name: string; source: string; apiData: unknown }> = [
  {
    name: "NEWS_en",
    source: "NEWS",
    apiData: {
      content: {
        title: "Sample headline",
        dek: "Sample dek",
        summary: "A".repeat(4000),
        // Realistic normalized shape: content.items (real articles), not sections.
        items: [
          { headline: "Item one headline", summary: "S".repeat(400), date: "2026-01-01", publisher: "Reuters" },
          { headline: "Item two headline", summary: "Second item summary", date: "2026-01-02", publisher: "Bloomberg" },
        ],
        notes: ["n1", "n2"],
      },
      search_results: [
        { title: "r1", snippet: "s1", url: "u1", publisher: "p1", date: "2026-01-01" },
        { title: "r2", snippet: "s2", url: "u2", publisher: "p2", date: "2026-01-02" },
      ],
      citations: ["c1", "c2"],
    },
  },
  {
    name: "COMPETITIVE_en",
    source: "COMPETITIVE",
    apiData: {
      company: "ACME",
      industry: "Widgets",
      overall_assessment: "X".repeat(500),
      forces: {
        competitive_rivalry: { score: 4, analysis: "Y".repeat(400) },
        threat_of_new_entrants: { score: 2, analysis: "Z".repeat(400) },
        threat_of_substitutes: { score: 3, analysis: "Q".repeat(400) },
        supplier_power: { score: 2, analysis: "W".repeat(400) },
        buyer_power: { score: 5, analysis: "E".repeat(400) },
      },
    },
  },
  {
    name: "PEER_STOCKS_en",
    source: "PEER_STOCKS",
    apiData: { ticker: "AAPL", similarStocks: [{ symbol: "MSFT" }, { symbol: "GOOG" }], count: 2 },
  },
  {
    name: "STOCK_PICKER_en",
    source: "STOCK_PICKER",
    apiData: {
      mode: "compare",
      labels: ["AAPL"],
      results: [
        {
          ticker: "AAPL",
          finalScore: 82,
          recommendation: "BUY",
          confidence: "HIGH",
          sentimentScore: 70,
          earningsScore: 80,
          financialScore: 90,
          valuationScore: 60,
          sentimentBreakdown: { key_drivers: ["d1", "d2", "d3", "d4"] },
          earningsBreakdown: { key_risks: ["r1", "r2", "r3", "r4"] },
        },
      ],
    },
  },
];

describe("simplifyApiData (snapshot behavior-lock)", () => {
  const files = readdirSync(FIXTURE_DIR).filter((f) => f.endsWith(".json"));

  for (const file of files) {
    it(`fixture ${file}`, () => {
      const { dataSource, apiData } = JSON.parse(readFileSync(join(FIXTURE_DIR, file), "utf8"));
      expect(simplifyApiData({ [dataSource]: apiData })).toMatchSnapshot();
    });
  }

  for (const { name, source, apiData } of SYNTHETIC) {
    it(`synthetic ${name}`, () => {
      expect(simplifyApiData({ [source]: apiData })).toMatchSnapshot();
    });
  }
});
