import { describe, expect, it } from "vitest";
import type { ListSnapshot } from "@shared/listSnapshot";
import type { ActiveListState } from "../conversation";
import { buildDrillPlan, detectDrillLens, resolveDrill } from "../drill";

/** A TRENDING activeList (origin TRENDING) with one top-gainers view of N members. */
function trending(tickers = ["BFLY", "WOLF", "QS"]): ActiveListState {
  const list: ListSnapshot = {
    source: "TRENDING",
    capturedAt: "2026-06-22T00:00:00.000Z",
    views: [{
      id: "top_gainers",
      label: "Top Gainers",
      ranking: { kind: "metric", field: "changePercent", direction: "desc" },
      items: tickers.map((ticker, i) => ({ ticker, name: `${ticker} Inc`, metrics: { changePercent: [55.8, 17.9, 16.5][i] ?? 1, price: 4 } })),
    }],
  };
  return { list, sources: [], origin: { source: "TRENDING", capturedAt: list.capturedAt } };
}

/** A multi-view TRENDING activeList (gainers + losers coexist). */
function multiView(): ActiveListState {
  const base = trending();
  base.list.views.push({
    id: "top_losers",
    label: "Top Losers",
    ranking: { kind: "metric", field: "changePercent", direction: "asc" },
    items: [
      { ticker: "DROP", name: "Drop Co", metrics: { changePercent: -9 } },
      { ticker: "FALL", name: "Fall Co", metrics: { changePercent: -7 } },
    ],
  });
  return base;
}

/** A STOCK_PICKER score-off activeList (origin STOCK_PICKER, comparison view). */
function scoreOff(): ActiveListState {
  const list: ListSnapshot = {
    source: "STOCK_PICKER",
    capturedAt: "2026-06-22T00:00:00.000Z",
    views: [{
      id: "comparison",
      label: "comparison",
      ranking: { kind: "metric", field: "finalScore", direction: "desc" },
      items: [
        { ticker: "AAA", name: "Alpha", metrics: { finalScore: 88 } },
        { ticker: "BBB", name: "Beta", metrics: { finalScore: 71 } },
      ],
    }],
  };
  return { list, sources: [], origin: { source: "STOCK_PICKER", capturedAt: list.capturedAt } };
}

describe("resolveDrill — ordinal location", () => {
  it("中文序数 第N个 → drills the Nth row (NEWS+STOCK_PRICE default lens)", () => {
    const out = resolveDrill("第二个详细说说", trending(), "zh");
    expect(out.kind).toBe("drill");
    if (out.kind !== "drill") return;
    expect(out.item.ticker).toBe("WOLF");
    expect(out.classification.tickers).toEqual(["WOLF"]);
    expect(out.classification.required_data).toEqual(["NEWS", "STOCK_PRICE"]);
    expect(out.classification.api_params.STOCK_PRICE).toEqual({ ticker: "WOLF" });
  });

  it("English ordinal: the first one / the 3rd stock", () => {
    expect((resolveDrill("tell me more about the first one", trending(), "en") as any).item.ticker).toBe("BFLY");
    expect((resolveDrill("what about the 3rd stock", trending(), "en") as any).item.ticker).toBe("QS");
  });

  it("does NOT match ordinal traps (first quarter / 第三方 / cardinal '3 stocks')", () => {
    expect(resolveDrill("how was its first quarter", trending(), "en").kind).toBe("none");
    expect(resolveDrill("第三方数据怎么说", trending(), "zh").kind).toBe("none");
    expect(resolveDrill("give me 3 stocks", trending(), "en").kind).toBe("none"); // cardinal, not "3rd"
  });

  it("out_of_range: 第六个 over a 3-row view → clarify, no drill", () => {
    const out = resolveDrill("第六个怎么样", trending(), "zh");
    expect(out.kind).toBe("clarify");
    if (out.kind === "clarify") {
      expect(out.reason).toBe("out_of_range");
      expect(out.message).toContain("3");
    }
  });

  it("ambiguous_view: ordinal over ≥2 coexisting views with no list named → clarify", () => {
    const out = resolveDrill("第一个怎么样", multiView(), "zh");
    expect(out.kind).toBe("clarify");
    if (out.kind === "clarify") expect(out.reason).toBe("ambiguous_view");
  });

  it("a named list disambiguates the ordinal (跌幅榜第一个 → top_losers row 1)", () => {
    const out = resolveDrill("跌幅榜第一个怎么样", multiView(), "zh");
    expect(out.kind).toBe("drill");
    if (out.kind === "drill") expect(out.item.ticker).toBe("DROP");
  });

  it("an explicitly named absent view does not fall back to the sole current view", () => {
    expect(resolveDrill("跌幅榜第一个怎么样", trending(), "zh")).toEqual({ kind: "none" });
    expect(resolveDrill("the first stock in top losers", trending(), "en")).toEqual({ kind: "none" });
  });
});

describe("resolveDrill — bare member reference", () => {
  it("a single member symbol with no lens → drills it (default lens)", () => {
    const out = resolveDrill("再说说 WOLF", trending(), "en");
    expect(out.kind).toBe("drill");
    if (out.kind === "drill") {
      expect(out.item.ticker).toBe("WOLF");
      expect(out.classification.required_data).toEqual(["NEWS", "STOCK_PRICE"]);
    }
  });

  it("two members named = a comparison, not a drill → none", () => {
    expect(resolveDrill("BFLY vs WOLF", trending(), "en").kind).toBe("none");
  });

  it("a member + an outside ticker (pivot) → none", () => {
    expect(resolveDrill("BFLY or NVDA", trending(), "en").kind).toBe("none");
  });

  it("a non-member ticker alone → none (a fresh entity, not a drill)", () => {
    expect(resolveDrill("NVDA", trending(), "en").kind).toBe("none");
  });

  it("a member with a non-drill intent defers to normal classification", () => {
    expect(resolveDrill("Should I buy WOLF?", trending(), "en")).toEqual({ kind: "none" });
    expect(resolveDrill("WOLF moat", trending(), "en")).toEqual({ kind: "none" });
    expect(resolveDrill("WOLF market cap", trending(), "en")).toEqual({ kind: "none" });
  });
});

describe("resolveDrill — explicit lens override vs defer", () => {
  it("ordinal + explicit lens → that lens wins over the factory default", () => {
    const out = resolveDrill("第一个的估值如何", trending(), "zh");
    expect(out.kind).toBe("drill");
    if (out.kind === "drill") {
      expect(out.item.ticker).toBe("BFLY");
      expect(out.classification.required_data).toEqual(["VALUATION"]);
      expect(out.classification.api_params.VALUATION.ticker).toBe("BFLY");
    }
  });

  it("bare member + explicit lens → defer to the classifier (none)", () => {
    // "BFLY valuation" routes fine through the classifier and member_reference preserves
    // the list — the drill resolver only owns the bare (no-lens) case.
    expect(resolveDrill("BFLY valuation", trending(), "en").kind).toBe("none");
  });

  it("detectDrillLens maps the common single lenses", () => {
    expect(detectDrillLens("估值")).toBe("VALUATION");
    expect(detectDrillLens("analyst rating")).toBe("RATING");
    expect(detectDrillLens("基本面")).toBe("PERFORMANCE");
    expect(detectDrillLens("latest news")).toBe("NEWS");
    expect(detectDrillLens("current price")).toBe("STOCK_PRICE");
    expect(detectDrillLens("earnings call")).toBeNull();
    expect(detectDrillLens("财报电话会")).toBeNull();
    expect(detectDrillLens("详细说说")).toBeNull();
  });

  it("ordinal + unsupported or mixed intent resolves the ticker then requests classification", () => {
    for (const query of [
      "Should I buy the first one?",
      "the first one market cap",
      "the first one earnings call",
      "should I buy the first one based on valuation",
    ]) {
      const out = resolveDrill(query, trending(), "en");
      expect(out.kind).toBe("classify");
      if (out.kind === "classify") {
        expect(out.item.ticker).toBe("BFLY");
        expect(out.effectiveQuery).toContain("BFLY");
      }
    }
  });
});

describe("resolveDrill — guards", () => {
  it("no activeList → none", () => {
    expect(resolveDrill("第一个怎么样", undefined, "zh").kind).toBe("none");
  });

  it("set-anaphor + ordinal binds the list; set-anaphor alone stays with set-screen / set_choice", () => {
    const ordinal = resolveDrill("其中第一个", trending(), "zh");
    expect(ordinal.kind).toBe("drill");
    if (ordinal.kind === "drill") expect(ordinal.item.ticker).toBe("BFLY");
    expect(resolveDrill("which of these is best", trending(), "en").kind).toBe("none");
  });

  it("explicit list pivot → none", () => {
    expect(resolveDrill("show me another list", trending(), "en").kind).toBe("none");
  });
});

describe("buildDrillPlan — factory lens by origin (reads origin, not the latest lens)", () => {
  it("TRENDING mover → NEWS + STOCK_PRICE (why it moved + price)", () => {
    const al = trending();
    const plan = buildDrillPlan(al.list.views[0], "BFLY", al, "en");
    expect(plan.requiredData).toEqual(["NEWS", "STOCK_PRICE"]);
    expect(plan.apiParams.STOCK_PRICE).toEqual({ ticker: "BFLY" });
  });

  it("STOCK_PICKER score-off row → re-score that one ticker (STOCK_PICKER)", () => {
    const al = scoreOff();
    const plan = buildDrillPlan(al.list.views[0], "AAA", al, "en");
    expect(plan.requiredData).toEqual(["STOCK_PICKER"]);
    expect((plan.apiParams.STOCK_PICKER as any).tickers).toEqual(["AAA"]);
  });

  it("a picker TRENDING view (id starts with 'trending') drills like a mover, not a score-off", () => {
    const al = scoreOff();
    al.origin.source = "STOCK_PICKER";
    const view = { ...al.list.views[0], id: "trending top_gainers" };
    expect(buildDrillPlan(view, "AAA", al, "en").requiredData).toEqual(["NEWS", "STOCK_PRICE"]);
  });
});

describe("resolveDrill — picker score-off drill end to end", () => {
  it("ordinal over a score-off → single STOCK_PICKER plan", () => {
    const out = resolveDrill("第二个", scoreOff(), "en");
    expect(out.kind).toBe("drill");
    if (out.kind === "drill") {
      expect(out.item.ticker).toBe("BBB");
      expect(out.classification.required_data).toEqual(["STOCK_PICKER"]);
    }
  });
});
