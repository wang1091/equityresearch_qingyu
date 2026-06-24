import { describe, expect, it } from "vitest";
import type { ListSnapshot } from "@shared/listSnapshot";
import type { ActiveListState } from "../conversation";
import { detectComputePredicate, resolveComputed } from "../computed";

/** A TRENDING activeList (origin TRENDING) with one top-gainers view, all changePercent > 0. */
function trending(): ActiveListState {
  const list: ListSnapshot = {
    source: "TRENDING",
    capturedAt: "2026-06-22T00:00:00.000Z",
    views: [{
      id: "top_gainers",
      label: "Top Gainers",
      ranking: { kind: "metric", field: "changePercent", direction: "desc" },
      items: [
        { ticker: "BFLY", name: "Butterfly", metrics: { changePercent: 55.8, price: 4 } },
        { ticker: "WOLF", name: "Wolfspeed", metrics: { changePercent: 17.9, price: 8 } },
        { ticker: "QS", name: "QuantumScape", metrics: { changePercent: 16.5, price: 6 } },
      ],
    }],
  };
  return {
    list,
    sources: [{ type: "data", id: "trending", provider: "TRENDING", asOf: list.capturedAt }],
    origin: { source: "TRENDING", capturedAt: list.capturedAt },
  };
}

/** gainers + losers coexist. */
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

/** A STOCK_PICKER score-off activeList (finalScore metric, no changePercent). */
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

/** Two compatible score views, used to exercise resumable view clarification. */
function multiScoreView(): ActiveListState {
  const base = scoreOff();
  base.list.views[0] = { ...base.list.views[0], id: "top_gainers", label: "Score Gainers" };
  base.list.views.push({
    id: "top_losers",
    label: "Score Losers",
    ranking: { kind: "metric", field: "finalScore", direction: "desc" },
    items: [
      { ticker: "CCC", name: "Gamma", metrics: { finalScore: 92 } },
      { ticker: "DDD", name: "Delta", metrics: { finalScore: 64 } },
    ],
  });
  return base;
}

describe("detectComputePredicate", () => {
  it("maps gain/loss/score superlatives, score before move", () => {
    expect(detectComputePredicate("涨最多的")?.field).toBe("changePercent");
    expect(detectComputePredicate("which gained the most")?.direction).toBe("max");
    expect(detectComputePredicate("跌最多的")?.direction).toBe("min");
    expect(detectComputePredicate("the biggest loser")?.field).toBe("changePercent");
    expect(detectComputePredicate("评分最高的")).toMatchObject({ field: "finalScore", direction: "max" });
    expect(detectComputePredicate("lowest score")).toMatchObject({ field: "finalScore", direction: "min" });
    expect(detectComputePredicate("best rated one")?.field).toBe("finalScore");
    expect(detectComputePredicate("best performer")?.field).toBe("changePercent");
  });

  it("returns null for non-superlatives and uncomputable fields", () => {
    expect(detectComputePredicate("tell me about these")).toBeNull();
    expect(detectComputePredicate("哪个好")).toBeNull();
    // 市值最大 / 估值最低 are NOT list metrics → not computable here (defer to fetch).
    expect(detectComputePredicate("市值最大的")).toBeNull();
    expect(detectComputePredicate("lowest valuation")).toBeNull();
  });
});

describe("resolveComputed — compute over live numbers", () => {
  it("其中涨最多 → argmax changePercent, focus winner, list preserved", () => {
    const out = resolveComputed("其中涨最多的是哪只", trending(), "zh");
    expect(out.kind).toBe("compute");
    if (out.kind === "compute") {
      expect(out.ticker).toBe("BFLY");
      expect(out.answer).toContain("BFLY");
      expect(out.answer).toContain("+55.80%");
      expect(out.answer).toContain("TRENDING");
      expect(out.answer).toContain("来源：");
      expect(out.claim).not.toContain("来源：");
    }
  });

  it("English 'which gained the most' → BFLY", () => {
    const out = resolveComputed("which one gained the most", trending(), "en");
    expect(out.kind).toBe("compute");
    if (out.kind === "compute") expect(out.ticker).toBe("BFLY");
  });

  it("跌最多 over coexisting gainers+losers picks the losers view (argmin)", () => {
    const out = resolveComputed("其中跌最多的", multiView(), "zh");
    expect(out.kind).toBe("compute");
    if (out.kind === "compute") {
      expect(out.ticker).toBe("DROP");
      expect(out.answer).toContain("-9.00%");
    }
  });

  it("涨最多 over coexisting views picks the gainers view (implied semantic disambiguates)", () => {
    const out = resolveComputed("涨最多的是哪个", multiView(), "zh");
    expect(out.kind).toBe("compute");
    if (out.kind === "compute") expect(out.ticker).toBe("BFLY");
  });

  it("评分最高/最低 over a score-off → finalScore argmax/argmin", () => {
    expect((resolveComputed("评分最高的是哪个", scoreOff(), "zh") as any).ticker).toBe("AAA");
    expect((resolveComputed("which has the lowest score", scoreOff(), "en") as any).ticker).toBe("BBB");
  });

  it("computes over the rows WITH data and notes the partial coverage", () => {
    const al = trending();
    al.list.views[0].items.push({ ticker: "NOPCT", name: "No Pct", metrics: { price: 3 } }); // no changePercent
    const out = resolveComputed("涨最多的", al, "en");
    expect(out.kind).toBe("compute");
    if (out.kind === "compute") {
      expect(out.ticker).toBe("BFLY");
      expect(out.answer).toContain("based on the 3 with data");
    }
  });
});

describe("resolveComputed — empty_domain (honest, no winner label)", () => {
  it("跌最多 over an all-up gainers view → no winner, preserved", () => {
    const out = resolveComputed("其中跌最多的是哪只", trending(), "zh");
    expect(out.kind).toBe("empty_domain");
    if (out.kind === "empty_domain") {
      expect(out.answer).toContain("都没有下跌");
      expect(out.answer).toContain("QS"); // smallest gain
    }
  });

  it("biggest gainer over an all-down losers-only view → none are up", () => {
    const losersOnly: ActiveListState = (() => {
      const list: ListSnapshot = {
        source: "TRENDING",
        capturedAt: "2026-06-22T00:00:00.000Z",
        views: [{
          id: "top_losers",
          label: "Top Losers",
          ranking: { kind: "metric", field: "changePercent", direction: "asc" },
          items: [
            { ticker: "DROP", name: "Drop Co", metrics: { changePercent: -9 } },
            { ticker: "FALL", name: "Fall Co", metrics: { changePercent: -7 } },
          ],
        }],
      };
      return { list, sources: [], origin: { source: "TRENDING", capturedAt: list.capturedAt } };
    })();
    const out = resolveComputed("which of these gained the most", losersOnly, "en");
    expect(out.kind).toBe("empty_domain");
    if (out.kind === "empty_domain") {
      expect(out.answer).toContain("are up right now");
      expect(out.answer).toContain("FALL"); // smallest decline (least negative)
    }
  });
});

describe("resolveComputed — defers / clarifies", () => {
  it("no active list → none", () => {
    expect(resolveComputed("涨最多的", undefined, "zh").kind).toBe("none");
  });

  it("an ordinal is DRILL's job, not argmax → none", () => {
    expect(resolveComputed("第二个涨最多吗", trending(), "zh").kind).toBe("none");
  });

  it("a field absent from the snapshot defers (评分 over a trending board)", () => {
    expect(resolveComputed("评分最高的", trending(), "zh").kind).toBe("none");
  });

  it("an explicit list pivot defers", () => {
    expect(resolveComputed("换一批，涨最多的", trending(), "zh").kind).toBe("none");
  });

  it("a named-but-absent view defers to a fresh fetch", () => {
    expect(resolveComputed("跌幅榜里涨最多的", trending(), "zh").kind).toBe("none");
  });

  it("weak ellipsis requires a matching semantic view and rejects a fresh subject", () => {
    expect(resolveComputed("跌最多的是哪只", trending(), "zh").kind).toBe("none");
    expect(resolveComputed("which sector gained the most", trending(), "en").kind).toBe("none");
    expect(resolveComputed("其中跌最多的是哪只", trending(), "zh").kind).toBe("empty_domain");
  });

  it("a field absent from every coexisting view defers instead of asking a useless question", () => {
    expect(resolveComputed("其中评分最高的", multiView(), "zh").kind).toBe("none");
  });

  it("strong set-anaphor + multiple compatible views clarifies and resumes from a short view reply", () => {
    const active = multiScoreView();
    const strong = resolveComputed("其中评分最高的", active, "zh");
    expect(strong.kind).toBe("clarify");
    if (strong.kind !== "clarify") return;
    expect(strong.reason).toBe("ambiguous_view");
    const resumed = resolveComputed("跌幅榜", active, "zh", strong.pending);
    expect(resumed.kind).toBe("compute");
    if (resumed.kind === "compute") expect(resumed.ticker).toBe("CCC");
  });
});

// ── REFINE_SET: super-table superlatives (field not in the snapshot) ──────────────
describe("resolveComputed — REFINE_SET (materialize set + re-classify)", () => {
  it("'其中市值最大' → refine_set with the bound view's tickers materialized", () => {
    const r = resolveComputed("其中市值最大的是哪只", trending(), "zh");
    expect(r.kind).toBe("refine_set");
    if (r.kind !== "refine_set") return;
    expect(r.tickers).toEqual(["BFLY", "WOLF", "QS"]); // from view.items, not a classifier re-parse
    expect(r.effectiveQuery).toContain("BFLY");
    expect(r.effectiveQuery).toContain("WOLF");
    expect(r.effectiveQuery).toContain("QS");
  });

  it("'业绩最强' / 'strongest fundamentals' bind the set (fundamentals → re-classify)", () => {
    expect(resolveComputed("其中业绩最强的是哪个", trending(), "zh").kind).toBe("refine_set");
    expect(resolveComputed("of these, which has the strongest fundamentals", trending(), "en").kind).toBe("refine_set");
  });

  it("'估值最低' (valuation) binds the set", () => {
    expect(resolveComputed("其中估值最低的", trending(), "zh").kind).toBe("refine_set");
    expect(resolveComputed("of these which is the cheapest", trending(), "en").kind).toBe("refine_set");
  });

  it("English market cap over the set → refine_set", () => {
    const r = resolveComputed("of these, which has the largest market cap", trending(), "en");
    expect(r.kind).toBe("refine_set");
    if (r.kind === "refine_set") expect(r.effectiveQuery.startsWith("Among ")).toBe(true);
  });

  it("a BARE super-table superlative (no set ref, no named view) DEFERS — won't re-fetch loosely", () => {
    expect(resolveComputed("市值最大的科技股", trending(), "zh").kind).toBe("none");
    expect(resolveComputed("which mega-cap has the biggest market cap", trending(), "en").kind).toBe("none");
  });

  it("strong set ref over COEXISTING views → clarify (which list?), not a blind fetch", () => {
    const r = resolveComputed("其中市值最大的", multiView(), "zh");
    expect(r.kind).toBe("clarify");
    if (r.kind === "clarify") expect(r.reason).toBe("ambiguous_view");
  });

  it("in-table superlative still computes in place (NOT refine_set) — regression", () => {
    expect(resolveComputed("其中涨最多的", trending(), "zh").kind).toBe("compute");
  });

  it("no active list → none", () => {
    expect(resolveComputed("其中市值最大的", undefined, "zh").kind).toBe("none");
  });
});
