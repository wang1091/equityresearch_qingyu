import { describe, it, expect } from "vitest";
import { detectJustify, answerJustify } from "../justify";
import { activeListClaimState, buildClaimState } from "../claim";
import type { ActiveListState, LastTurnFrame } from "../conversation";
import type { Source } from "../provenance";
import type { ListSnapshot } from "@shared/listSnapshot";

// ── fixtures ──────────────────────────────────────────────────────────────────
const list: ListSnapshot = {
  source: "TRENDING",
  capturedAt: "2026-06-21T00:00:00.000Z",
  views: [{
    id: "top_gainers",
    label: "Top Gainers",
    ranking: { kind: "metric", field: "changePercent", direction: "desc" },
    items: [
      { ticker: "BFLY", name: "Butterfly", metrics: { changePercent: 55.8 } },
      { ticker: "WOLF", name: "Wolfspeed", metrics: { changePercent: 17.91 } },
    ],
  }],
};
const sources: Source[] = [{ type: "data", id: "trending", provider: "TRENDING", asOf: list.capturedAt }];
const activeList: ActiveListState = { list, sources, origin: { source: "TRENDING", capturedAt: list.capturedAt } };
const frame: LastTurnFrame = {
  classification: { required_data: ["TRENDING"], primary_focus: "TRENDING", tickers: [], api_params: {}, need_api: true },
  answerIntent: "lookup",
  resultTickers: ["BFLY"],
  source: "TRENDING",
  snapshot: { capturedAt: list.capturedAt, validData: { TRENDING: {} }, sources },
  activeList,
};
const extreme = { kind: "list_extreme", viewId: "top_gainers", field: "changePercent", direction: "max", winnerTicker: "BFLY" } as const;

describe("detectJustify — fires on meta-questions about our claim", () => {
  for (const q of ["为什么这么说", "凭什么这么说？", "你怎么知道的", "依据是什么", "这准吗", "怎么得出的", "why do you say that?", "How do you know?", "what's the basis", "is that accurate?", "says who"]) {
    it(`fires: ${q}`, () => expect(detectJustify(q)).toBe(true));
  }
});

describe("detectJustify — does NOT hijack genuine subject questions", () => {
  for (const q of ["为什么 BFLY today大涨", "why did BFLY drop today", "BFLY 的基本面怎么样", "what is the price of NVDA", "为什么半导体板块走强", "why do you say that BFLY will rise"]) {
    it(`stays out: ${q}`, () => expect(detectJustify(q)).toBe(false));
  }
});

describe("answerJustify — list_extreme replays the frozen comparison", () => {
  it("explains the winner vs runner-up over the view, cites the list sources, no fetch", () => {
    const state = activeListClaimState("BFLY rose the most, +55.80%", activeList, extreme);
    const out = answerJustify(state, frame, "en");
    expect(out).toContain("Top Gainers");
    expect(out).toContain("BFLY");
    expect(out).toContain("+55.80%");
    expect(out).toContain("WOLF"); // runner-up shown
    expect(out).toContain("Based on:");
    expect(out).toContain("TRENDING");
  });

  it("zh structural explanation", () => {
    const state = activeListClaimState("BFLY 涨得最多", activeList, extreme);
    const out = answerJustify(state, frame, "zh");
    expect(out).toContain("Top Gainers");
    expect(out).toContain("依据：");
    expect(out).toContain("没有额外取数");
  });

  it("falls back to an honest restate when the backing list was replaced (evidence unavailable)", () => {
    const state = activeListClaimState("BFLY rose the most", activeList, extreme);
    const replaced: LastTurnFrame = { ...frame, activeList: undefined };
    const out = answerJustify(state, replaced, "en");
    expect(out).not.toContain("Based on:"); // no provenance to cite
    expect(out.toLowerCase()).toContain("no structured derivation");
  });

  // Fail-CLOSED: a NEW list exposing the same viewId with DIFFERENT numbers must NOT be
  // replayed over — capturedAt mismatch → honest restate, never a fabricated "why".
  it("does not replay over a swapped list that reuses the viewId", () => {
    const state = activeListClaimState("BFLY rose the most", activeList, extreme);
    const swapped: LastTurnFrame = {
      ...frame,
      activeList: {
        list: {
          source: "TRENDING",
          capturedAt: "2026-06-22T00:00:00.000Z", // different capture → handle no longer matches
          views: [{ id: "top_gainers", label: "Top Gainers", ranking: list.views[0].ranking, items: [
            { ticker: "ZZZ", name: "Zeta", metrics: { changePercent: 99.9 } },
          ] }],
        },
        sources,
        origin: { source: "TRENDING", capturedAt: "2026-06-22T00:00:00.000Z" },
      },
    };
    const out = answerJustify(state, swapped, "en");
    expect(out).not.toContain("ZZZ"); // must not cite the swapped list's leader
    expect(out).not.toContain("ranked by"); // no structural replay
  });

  // Momentum ranks over a SUBSET of the view; JUSTIFY must replay that subset, not the whole
  // board, or it would name a different winner than the claim.
  it("replays only the frozen candidate subset for a momentum-style extreme", () => {
    const subsetDeriv = { ...extreme, winnerTicker: "WOLF", candidateTickers: ["WOLF"] } as const;
    const state = activeListClaimState("On momentum, WOLF is strongest", activeList, subsetDeriv);
    const out = answerJustify(state, frame, "en");
    expect(out).toContain("WOLF"); // the subset winner the claim named
    expect(out).not.toContain("BFLY"); // the global leader is NOT in the compared set
  });
});

describe("answerJustify — direction / ties / empty-domain honesty", () => {
  // P1: a MIN extreme winner is BELOW the runner-up, never "ahead of" it.
  function lossFrame(): { state: ReturnType<typeof activeListClaimState>; frame: LastTurnFrame } {
    const lossList: ListSnapshot = {
      source: "TRENDING", capturedAt: "2026-06-21T00:00:00.000Z",
      views: [{ id: "top_losers", label: "Top Losers", ranking: { kind: "metric", field: "changePercent", direction: "asc" }, items: [
        { ticker: "DROP", name: "Dropco", metrics: { changePercent: -9 } },
        { ticker: "DIP", name: "Dipco", metrics: { changePercent: -7 } },
      ] }],
    };
    const al: ActiveListState = { list: lossList, sources, origin: { source: "TRENDING", capturedAt: lossList.capturedAt } };
    const deriv = { kind: "list_extreme", viewId: "top_losers", field: "changePercent", direction: "min", winnerTicker: "DROP" } as const;
    return {
      state: activeListClaimState("DROP fell the most, -9.00%", al, deriv),
      frame: { ...frame, activeList: al, snapshot: { capturedAt: lossList.capturedAt, validData: { TRENDING: {} }, sources } },
    };
  }

  it("min winner is described as BELOW the runner-up, not ahead of it", () => {
    const { state, frame: f } = lossFrame();
    const out = answerJustify(state, f, "en");
    expect(out).toContain("below"); // -9% is below -7%
    expect(out).not.toContain("ahead of"); // the old bug
    const zhOut = answerJustify(state, f, "zh");
    expect(zhOut).toContain("低于");
    expect(zhOut).not.toContain("高于");
  });

  it("lowest score (finalScore min) reads as 'lowest' and 'below', with the score label", () => {
    const scoreList: ListSnapshot = {
      source: "STOCK_PICKER", capturedAt: "2026-06-21T00:00:00.000Z",
      views: [{ id: "score", label: "Score Board", ranking: { kind: "metric", field: "finalScore", direction: "asc" }, items: [
        { ticker: "LOW", name: "Lowco", metrics: { finalScore: 41 } },
        { ticker: "MID", name: "Midco", metrics: { finalScore: 73 } },
      ] }],
    };
    const al: ActiveListState = { list: scoreList, sources, origin: { source: "STOCK_PICKER", capturedAt: scoreList.capturedAt } };
    const deriv = { kind: "list_extreme", viewId: "score", field: "finalScore", direction: "min", winnerTicker: "LOW" } as const;
    const state = activeListClaimState("LOW scores lowest, 41", al, deriv);
    const f: LastTurnFrame = { ...frame, activeList: al, snapshot: { capturedAt: scoreList.capturedAt, validData: { STOCK_PICKER: {} }, sources } };
    const out = answerJustify(state, f, "en");
    expect(out).toContain("score"); // field label
    expect(out).toContain("lowest");
    expect(out).toContain("below"); // 41 is below 73
    expect(out).not.toContain("%"); // finalScore is not a percentage
  });

  it("a tie is stated as a tie, not as the winner leading", () => {
    const tieList: ListSnapshot = {
      source: "TRENDING", capturedAt: "2026-06-21T00:00:00.000Z",
      views: [{ id: "top_gainers", label: "Top Gainers", ranking: list.views[0].ranking, items: [
        { ticker: "AAA", name: "Aco", metrics: { changePercent: 3 } },
        { ticker: "BBB", name: "Bco", metrics: { changePercent: 3 } },
      ] }],
    };
    const al: ActiveListState = { list: tieList, sources, origin: { source: "TRENDING", capturedAt: tieList.capturedAt } };
    const state = activeListClaimState("AAA gained the most, +3.00%", al, { ...extreme, winnerTicker: "AAA" });
    const f: LastTurnFrame = { ...frame, activeList: al, snapshot: { capturedAt: tieList.capturedAt, validData: { TRENDING: {} }, sources } };
    const out = answerJustify(state, f, "en");
    expect(out).toContain("tied");
    expect(out).not.toContain("ahead of");
  });

  // The reviewer's exact scenario: all-DOWN board, asked "涨最多" → "none are up", tone kept.
  it("empty-domain all-down/ask-gainers keeps the 'none are up' tone, not 'X is highest'", () => {
    const downList: ListSnapshot = {
      source: "TRENDING", capturedAt: "2026-06-21T00:00:00.000Z",
      views: [{ id: "top_losers", label: "Top Losers", ranking: list.views[0].ranking, items: [
        { ticker: "AAA", name: "Aco", metrics: { changePercent: -2 } },
        { ticker: "BBB", name: "Bco", metrics: { changePercent: -5 } },
      ] }],
    };
    const al: ActiveListState = { list: downList, sources, origin: { source: "TRENDING", capturedAt: downList.capturedAt } };
    const deriv = { kind: "list_empty_domain", viewId: "top_losers", field: "changePercent", missingSign: "positive", boundaryTicker: "AAA" } as const;
    const state = activeListClaimState("None are up; smallest decline is AAA", al, deriv);
    const f: LastTurnFrame = { ...frame, activeList: al, snapshot: { capturedAt: downList.capturedAt, validData: { TRENDING: {} }, sources } };
    const out = answerJustify(state, f, "en");
    expect(out).toContain("none are up"); // tone preserved
    expect(out).not.toContain("highest"); // NOT the plain-extreme phrasing
    expect(out).not.toContain("ahead of");
  });

  // P2: empty-domain explains "none qualify", not a misleading "X is the lowest".
  it("list_empty_domain explains the whole-domain judgment, not a plain extreme", () => {
    const upList: ListSnapshot = {
      source: "TRENDING", capturedAt: "2026-06-21T00:00:00.000Z",
      views: [{ id: "top_gainers", label: "Top Gainers", ranking: list.views[0].ranking, items: [
        { ticker: "BFLY", name: "Butterfly", metrics: { changePercent: 2 } },
        { ticker: "WOLF", name: "Wolfspeed", metrics: { changePercent: 5 } },
      ] }],
    };
    const al: ActiveListState = { list: upList, sources, origin: { source: "TRENDING", capturedAt: upList.capturedAt } };
    const deriv = { kind: "list_empty_domain", viewId: "top_gainers", field: "changePercent", missingSign: "negative", boundaryTicker: "BFLY" } as const;
    const state = activeListClaimState("None are down; smallest gain is BFLY", al, deriv);
    const f: LastTurnFrame = { ...frame, activeList: al, snapshot: { capturedAt: upList.capturedAt, validData: { TRENDING: {} }, sources } };
    const out = answerJustify(state, f, "en");
    expect(out).toContain("none are down");
    expect(out).toContain("BFLY"); // the boundary
    expect(out).not.toContain("ranked by"); // not the plain-extreme phrasing
    expect(out).not.toContain("below the runner-up");
  });
});

describe("answerJustify — synthesized restates + cites, no fabricated causality", () => {
  it("restates the claim and cites snapshot sources, without an argmax explanation", () => {
    const state = buildClaimState([
      { text: "BFLY's move was driven by an FDA clearance.", subjectTickers: ["BFLY"], evidenceRef: { kind: "snapshot", capturedAt: frame.snapshot!.capturedAt }, derivation: { kind: "synthesized" } },
    ]);
    const out = answerJustify(state, frame, "en");
    expect(out).toContain("data retrieved last turn");
    expect(out).toContain("FDA clearance");
    expect(out).toContain("Based on:");
    expect(out).not.toContain("ranked by"); // no fabricated structural comparison
  });

  // Step 5: a DRILL / plain data answer writes a TEXT-LESS synthesized claim (no one-liner).
  // JUSTIFY grounds it in provenance + names the subject, without echoing prose or faking a why.
  it("text-less synthesized claim → provenance-grounded answer naming the subject, no prose echo", () => {
    const state = buildClaimState([
      { text: "", subjectTickers: ["BFLY"], evidenceRef: { kind: "snapshot", capturedAt: frame.snapshot!.capturedAt }, derivation: { kind: "synthesized" } },
    ]);
    const out = answerJustify(state, frame, "en");
    expect(out).toContain("about BFLY"); // names the subject
    expect(out).toContain("synthesized from the data retrieved");
    expect(out).toContain("Based on:"); // cites provenance
    expect(out).not.toContain("ranked by"); // no fabricated structural comparison
  });

  it("text-less synthesized with no resolvable evidence → honest, no sources", () => {
    const state = buildClaimState([
      { text: "", subjectTickers: ["BFLY"], evidenceRef: { kind: "snapshot", capturedAt: "stale" }, derivation: { kind: "synthesized" } },
    ]);
    const out = answerJustify(state, frame, "en"); // frame.snapshot is t2 ≠ stale → unavailable
    expect(out).not.toContain("Based on:");
    expect(out.toLowerCase()).toContain("no structured derivation");
  });
});
