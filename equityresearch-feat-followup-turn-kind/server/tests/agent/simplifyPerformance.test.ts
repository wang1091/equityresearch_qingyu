// Unit net for simplifyPerformance (server/performance/service.ts) — guards the
// Phase 3 fix: upstream primary-company-analysis emits a STRUCTURED JSON object,
// not "►► PEER COMPARISON:" prose. The old code grepped the dead headings and so
// always fell to substring(0,800), feeding the LLM a truncated JSON blob and
// dropping the rating + peerConclusion.
import { describe, it, expect } from "vitest";
import { simplifyPerformance } from "../../performance/service";

const structuredAnalysis = JSON.stringify({
  rating: "Fairly Valued",
  summary: ["AAPL grew revenue 8% YoY", "Margins stable", "extra1", "extra2", "extra3", "extra4", "extra5"],
  financial_performance: ["Revenue $123B", "Net income $34B"],
  peer_comparison_rank: ["#1 by market cap"],
  valuation_ratios: ["P/E 31x", "P/S 8x"],
});

describe("simplifyPerformance", () => {
  it("parses the structured JSON analysis into fields (rating + arrays), not a truncated string", () => {
    const out = simplifyPerformance({
      primaryTicker: "AAPL",
      analysis: { ticker: "AAPL", period: "Q1 2026", analysis: structuredAnalysis },
      peers: ["MSFT"],
    });
    expect(out.analysis.rating).toBe("Fairly Valued");
    expect(out.analysis.financialPerformance).toEqual(["Revenue $123B", "Net income $34B"]);
    expect(out.analysis.valuationRatios).toEqual(["P/E 31x", "P/S 8x"]);
    // arrays capped at 6 entries
    expect(out.analysis.summary).toHaveLength(6);
    // the analysis field must be a parsed object, never a raw/truncated JSON string
    expect(typeof out.analysis).toBe("object");
    expect(typeof out.analysis.rating).toBe("string");
    // content is intact, not cut mid-string by a substring() budget
    expect(out.analysis.financialPerformance[0]).toBe("Revenue $123B");
  });

  it("handles a ```json fenced structured analysis", () => {
    const out = simplifyPerformance({
      primaryTicker: "AAPL",
      analysis: { analysis: "```json\n" + structuredAnalysis + "\n```" },
    });
    expect(out.analysis.rating).toBe("Fairly Valued");
  });

  it("falls back to prose truncation (budget 2000) for non-JSON analysis", () => {
    const prose = "X".repeat(5000);
    const out = simplifyPerformance({
      primaryTicker: "AAPL",
      analysis: { analysis: prose },
    });
    expect(typeof out.analysis).toBe("string");
    expect((out.analysis as string).length).toBe(2000);
  });

  it("surfaces the bilingual peerConclusion takeaway (previously dropped)", () => {
    const out = simplifyPerformance({
      primaryTicker: "AAPL",
      peerConclusion: { en: "AAPL leads peers on FCF margin.", zh: "苹果自由现金流领先同业。" },
    });
    expect(out.peerTakeaway).toBe("AAPL leads peers on FCF margin.");
  });

  it("builds a latest-quarter peerComparison with each peer's ABSOLUTE values (regression: LLM saw only the primary + inverted the direction)", () => {
    const out = simplifyPerformance({
      primaryTicker: "AMD",
      peers: ["INTC"],
      metrics: {
        AMD: { "Total Revenue": { "2025Q4": 9, "2026Q1": 10 }, "Gross Margin %": { "2025Q4": 54.3, "2026Q1": 52.8 } },
        INTC: { "Total Revenue": { "2025Q4": 14, "2026Q1": 13 }, "Gross Margin %": { "2025Q4": 36.1, "2026Q1": 39.4 } },
      },
    });
    expect(out.peerComparison.AMD.period).toBe("2026Q1");
    expect(out.peerComparison.AMD["Gross Margin %"]).toBe(52.8);
    expect(out.peerComparison.INTC.period).toBe("2026Q1");
    expect(out.peerComparison.INTC["Gross Margin %"]).toBe(39.4); // peer absolute present → no delta-only inversion
  });

  it("uses each ticker's OWN latest quarter, so an offset-fiscal peer still contributes real values", () => {
    const out = simplifyPerformance({
      primaryTicker: "AMD",
      peers: ["NVDA"],
      metrics: {
        AMD: { "Total Revenue": { "2026Q1": 10 }, "Gross Margin %": { "2026Q1": 52.8 } },
        NVDA: { "Total Revenue": { "2026Q2": 30 }, "Gross Margin %": { "2026Q2": 75.0 } }, // different label
      },
    });
    expect(out.peerComparison.AMD.period).toBe("2026Q1");
    expect(out.peerComparison.NVDA.period).toBe("2026Q2");
    expect(out.peerComparison.NVDA["Gross Margin %"]).toBe(75.0); // not dropped despite period mismatch
  });

  it("omits peerComparison when there are no peers (single-ticker turn)", () => {
    const out = simplifyPerformance({
      primaryTicker: "AMD",
      peers: [],
      metrics: { AMD: { "Total Revenue": { "2026Q1": 10 }, "Gross Margin %": { "2026Q1": 52.8 } } },
    });
    expect(out.peerComparison).toBeUndefined();
  });

  it("extracts the last-5-quarter time series from metrics", () => {
    const out = simplifyPerformance({
      primaryTicker: "AAPL",
      metrics: {
        AAPL: {
          "Total Revenue": {
            Current: 999, "2024Q4": 1, "2025Q1": 2, "2025Q2": 3, "2025Q3": 4, "2025Q4": 5, "2026Q1": 6,
          },
        },
      },
    });
    expect(Object.keys(out.quarterlyTimeSeries["Total Revenue"])).toHaveLength(5);
    expect(out.quarterlyTimeSeries["Total Revenue"].Current).toBeUndefined();
  });
});
