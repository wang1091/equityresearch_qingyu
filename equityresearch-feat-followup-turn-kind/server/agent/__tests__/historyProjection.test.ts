import { describe, it, expect } from "vitest";
import { projectListTurnToHistory } from "../historyProjection";
import { formatHistoryAsText } from "../../llm/history";

// raw shapes mirror simplifyTrending / simplifyMarketData / simplifyStockPicker.
const trendingRaw = (n: number) => ({
  date: "2026-06-21",
  category: {
    id: "top_gainers",
    label: "涨幅最大",
    stocks: Array.from({ length: n }, (_, i) => ({
      ticker: ["BFLY", "WOLF", "QS", "BE", "OUST", "ACMR", "ENTG", "SMR", "CHRN", "XYZ", "EXTRA"][i] || `T${i}`,
      companyName: `Company Number ${i} Incorporated Holdings`, // long → must truncate
      price: 10 + i,
      changePercent: 55.87 - i * 4, // NUMBER, not "%"
      discussion_highlights: ["hot"],
    })),
  },
});

describe("projectListTurnToHistory", () => {
  it("TRENDING: frame + ticker/name/+pct, name truncated, % formatted from raw number", () => {
    const line = projectListTurnToHistory("TRENDING", trendingRaw(3))!;
    expect(line.startsWith("[TRENDING top_gainers @2026-06-21] ")).toBe(true);
    expect(line).toContain("BFLY/Company Number 0 +55.87%"); // 16-char name cap, +sign, 2dp
    expect(line).toContain("QS/");
    expect(line).not.toContain("price");
    expect(line).not.toContain("hot"); // highlight dropped
  });

  it("TRENDING: full ~10-stock set is routable (no top-5 cut) and fits the 400 cap", () => {
    const line = projectListTurnToHistory("TRENDING", trendingRaw(10))!;
    // every ticker present — the whole set must be routable, not just 5
    for (const t of ["BFLY", "WOLF", "QS", "BE", "OUST", "ACMR", "ENTG", "SMR", "CHRN", "XYZ"]) {
      expect(line).toContain(t);
    }
    expect(line).not.toContain("more"); // 10 fit within budget → no overflow marker
  });

  it("budget overflow appends (+N more) and never exceeds the 400-char turn cap", () => {
    const line = projectListTurnToHistory("TRENDING", trendingRaw(40))!;
    expect(line).toMatch(/\(\+\d+ more\)$/);
    // survives formatHistoryAsText's per-turn slice(0,400) uncut (prefix is extra)
    const rendered = formatHistoryAsText([{ role: "assistant", content: line }], {
      labels: { user: "用户", assistant: "助手" },
      maxChars: 400,
    });
    expect(rendered).toBe(`助手: ${line}`); // i.e. content was NOT truncated
  });

  it("MARKET_DATA: identity only (ticker/name/sector), no metrics, no axis", () => {
    const line = projectListTurnToHistory("MARKET_DATA", {
      success: true,
      queryType: "market_cap",
      fetchedAt: "2026-06-21T12:00:00Z",
      quotes: [
        { ticker: "AAPL", companyName: "Apple Inc.", sector: "Technology", marketCap: 3.1e12, pe: 30 },
        { ticker: "MSFT", companyName: "Microsoft Corp.", sector: "Technology", marketCap: 2.9e12 },
      ],
    })!;
    expect(line.startsWith("[MARKET_DATA market_cap @2026-06-21] ")).toBe(true);
    expect(line).toContain("AAPL/Apple Inc./Technology");
    expect(line).not.toMatch(/3\.1|marketCap|pe/i); // answer values dropped
  });

  it("STOCK_PICKER comparison: ticker + recommendation + finalScore", () => {
    const line = projectListTurnToHistory("STOCK_PICKER", {
      mode: "comparison",
      results: [
        { ticker: "NVDA", recommendation: "BUY", finalScore: 87, confidence: "HIGH" },
        { ticker: "AMD", recommendation: "HOLD", finalScore: 72 },
      ],
      labels: ["NVDA", "AMD"],
    })!;
    expect(line).toBe("[STOCK_PICKER comparison] NVDA BUY 87; AMD HOLD 72");
  });

  it("STOCK_PICKER trending: expands results[0].category.stocks (not the 1-entry results)", () => {
    const line = projectListTurnToHistory("STOCK_PICKER", {
      mode: "trending",
      labels: ["screener"],
      results: [
        {
          intent: "trending",
          category: {
            id: "top_losers",
            stocks: [
              { ticker: "QS", companyName: "QuantumScape Corp", changePercent: -8.1 },
              { ticker: "BE", companyName: "Bloom Energy", changePercent: -6.4 },
            ],
          },
        },
      ],
    })!;
    expect(line.startsWith("[STOCK_PICKER trending top_losers] ")).toBe(true);
    expect(line).toContain("QS/QuantumScape Cor -8.10%"); // negative %, name truncated to 16
    expect(line).toContain("BE/Bloom Energy -6.40%");
  });

  it("returns null for non-list source, errored payload, and empty list", () => {
    expect(projectListTurnToHistory("VALUATION", { foo: 1 })).toBeNull();
    expect(projectListTurnToHistory("TRENDING", { error: "x" })).toBeNull();
    expect(projectListTurnToHistory("MARKET_DATA", { success: false })).toBeNull();
    expect(projectListTurnToHistory("TRENDING", { date: "x", category: { id: "top_gainers", stocks: [] } })).toBeNull();
  });
});
