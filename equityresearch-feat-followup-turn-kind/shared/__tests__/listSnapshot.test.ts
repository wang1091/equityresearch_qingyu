import { describe, it, expect } from "vitest";
import {
  extractListSnapshot,
  hasRoutableView,
  capToVisible,
  LIST_VISIBLE_LIMIT,
  parsePct,
  parseNum,
  VIEW_REGISTRY,
} from "../listSnapshot";
import trendingFixture from "../../server/agent/__fixtures__/cards/TRENDING_normal_en.json";

const TRENDING_RAW = (trendingFixture as any).apiData;

describe("parsePct / parseNum — strict (no silent NaN)", () => {
  it("parsePct: number passthrough, '%'-string, reject garbage", () => {
    expect(parsePct(55.87)).toBe(55.87);
    expect(parsePct("55.87%")).toBe(55.87);
    expect(parsePct("-8.10%")).toBe(-8.1);
    expect(parsePct("16.52")).toBe(16.52);
    expect(parsePct("abc")).toBeNull();
    expect(parsePct("55.87%garbage")).toBeNull(); // must NOT swallow trailing junk
    expect(parsePct(NaN)).toBeNull();
    expect(parsePct(null)).toBeNull();
    expect(parsePct(undefined)).toBeNull();
  });

  it("parseNum: numeric string ok, empty/garbage → null", () => {
    expect(parseNum(4.2)).toBe(4.2);
    expect(parseNum("87")).toBe(87);
    expect(parseNum("")).toBeNull();
    expect(parseNum("x")).toBeNull();
    expect(parseNum(Infinity)).toBeNull();
  });
});

describe("extractListSnapshot — TRENDING (multi-view)", () => {
  it("produces all four coexisting views in payload order", () => {
    const snap = extractListSnapshot("TRENDING", TRENDING_RAW)!;
    expect(snap).not.toBeNull();
    expect(snap.source).toBe("TRENDING");
    expect(snap.views.map((v) => v.id)).toEqual([
      "top_gainers",
      "top_losers",
      "most_active",
      "most_discussed",
    ]);
  });

  it("keeps the FULL item set + order (no top-5 cut) === UI order", () => {
    const snap = extractListSnapshot("TRENDING", TRENDING_RAW)!;
    const gainers = snap.views.find((v) => v.id === "top_gainers")!;
    expect(gainers.items.map((i) => i.ticker)).toEqual(["BFLY", "WOLF", "QS", "BE", "OUST"]);
  });

  it("metrics are finite number | null; changePercent parsed from raw number", () => {
    const snap = extractListSnapshot("TRENDING", TRENDING_RAW)!;
    const gainers = snap.views.find((v) => v.id === "top_gainers")!;
    expect(gainers.items[0]).toMatchObject({
      ticker: "BFLY",
      name: "Butterfly Network",
      metrics: { changePercent: 55.87, price: 4.2 },
    });
    for (const v of snap.views) {
      for (const it of v.items) {
        for (const m of Object.values(it.metrics)) {
          expect(m === null || Number.isFinite(m)).toBe(true);
        }
      }
    }
  });

  it("ranking axis comes from VIEW_REGISTRY (gainers desc / losers asc / provider_order)", () => {
    const snap = extractListSnapshot("TRENDING", TRENDING_RAW)!;
    expect(snap.views.find((v) => v.id === "top_gainers")!.ranking).toEqual(VIEW_REGISTRY.top_gainers.ranking);
    expect(snap.views.find((v) => v.id === "top_losers")!.ranking).toEqual(VIEW_REGISTRY.top_losers.ranking);
    expect(snap.views.find((v) => v.id === "most_active")!.ranking).toEqual({ kind: "provider_order", semantic: "most_active" });
  });

  it("carries the upstream date as view.context.asOf", () => {
    const snap = extractListSnapshot("TRENDING", TRENDING_RAW)!;
    expect(snap.views[0].context?.asOf).toBe("2026-06-21");
  });

  it("error / empty payloads → null", () => {
    expect(extractListSnapshot("TRENDING", { success: false, error: "down" })).toBeNull();
    expect(extractListSnapshot("TRENDING", { date: "x", categories: [] })).toBeNull();
    expect(extractListSnapshot("TRENDING", { date: "x", category: { id: "top_gainers", stocks: [] } })).toBeNull();
    expect(extractListSnapshot("UNSUPPORTED", TRENDING_RAW)).toBeNull();
  });
});

describe("extractListSnapshot — STOCK_PICKER (two modes)", () => {
  it("trending mode: reads results[0].category.stocks (not the 1-entry results)", () => {
    const snap = extractListSnapshot("STOCK_PICKER", {
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
    expect(snap.views).toHaveLength(1);
    expect(snap.views[0].id).toBe("trending top_losers");
    expect(snap.views[0].items.map((i) => i.ticker)).toEqual(["QS", "BE"]);
    expect(snap.views[0].items[0].metrics.changePercent).toBe(-8.1);
  });

  it("comparison/score mode: name from labels, ranked by finalScore", () => {
    const snap = extractListSnapshot("STOCK_PICKER", {
      mode: "comparison",
      results: [
        { ticker: "NVDA", recommendation: "BUY", finalScore: 87 },
        { ticker: "AMD", recommendation: "HOLD", finalScore: 72 },
      ],
      labels: ["NVDA", "AMD"],
    })!;
    expect(snap.views[0].ranking).toEqual({ kind: "metric", field: "finalScore", direction: "desc" });
    expect(snap.views[0].items.map((i) => ({ t: i.ticker, s: i.metrics.finalScore }))).toEqual([
      { t: "NVDA", s: 87 },
      { t: "AMD", s: 72 },
    ]);
    // a score result has no changePercent → null, never NaN
    expect(snap.views[0].items[0].metrics.changePercent).toBeNull();
  });
});

describe("capToVisible — activeList equals the UI-visible rows, extractor stays full", () => {
  const raw20 = {
    date: "2026-06-21",
    categories: [
      {
        id: "top_gainers",
        label: "Top Gainers",
        stocks: Array.from({ length: 20 }, (_, i) => ({
          ticker: `T${i}`,
          companyName: `Company ${i}`,
          changePercent: 20 - i,
        })),
      },
    ],
  };

  it("extractor keeps the full upstream set (the projection routes over the broad set)", () => {
    expect(extractListSnapshot("TRENDING", raw20)!.views[0].items).toHaveLength(20);
  });

  it("capToVisible trims each view to LIST_VISIBLE_LIMIT (what the card slice(0,10) showed)", () => {
    const capped = capToVisible(extractListSnapshot("TRENDING", raw20)!);
    expect(LIST_VISIBLE_LIMIT).toBe(10);
    expect(capped.views[0].items).toHaveLength(10);
    expect(capped.views[0].items.at(-1)!.ticker).toBe("T9"); // row 11+ (T10..T19) not in activeList
  });

  it("no-op when a view already fits", () => {
    const small = extractListSnapshot("TRENDING", TRENDING_RAW)!;
    expect(capToVisible(small)).toEqual(small);
  });
});

describe("hasRoutableView — the ≥2-routable-item bar", () => {
  it("true for a TRENDING snapshot (multiple ≥2-ticker views)", () => {
    expect(hasRoutableView(extractListSnapshot("TRENDING", TRENDING_RAW)!)).toBe(true);
  });

  it("false when no view has ≥2 routable (ticker) items", () => {
    const single = extractListSnapshot("STOCK_PICKER", {
      mode: "single",
      results: [{ ticker: "NVDA", finalScore: 87 }],
      labels: ["NVDA"],
    })!;
    expect(hasRoutableView(single)).toBe(false);
  });
});
