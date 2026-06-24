import { describe, it, expect } from "vitest";
import {
  applyTurnTransition,
  answerTurnTransition,
  type LastTurnFrame,
  type LastAnswerSnapshot,
  type TurnStateTransition,
  type ActiveListState,
} from "../conversation";
import type { ListSnapshot } from "@shared/listSnapshot";

// ── fixtures ──────────────────────────────────────────────────────────────────
const listA: ListSnapshot = {
  source: "TRENDING",
  capturedAt: "2026-06-21T00:00:00.000Z",
  views: [
    {
      id: "top_gainers",
      label: "Top Gainers",
      ranking: { kind: "metric", field: "changePercent", direction: "desc" },
      items: [
        { ticker: "BFLY", name: "Butterfly", metrics: { changePercent: 55.87 } },
        { ticker: "WOLF", name: "Wolfspeed", metrics: { changePercent: 17.91 } },
      ],
    },
  ],
};
const listB: ListSnapshot = { ...listA, source: "STOCK_PICKER", views: [{ ...listA.views[0], id: "trending top_losers" }] };
const snapA: LastAnswerSnapshot = { capturedAt: "t1", validData: { TRENDING: {} }, sources: [{ type: "data", id: "s", provider: "TRENDING", asOf: "t1" } as any] };
const snapB: LastAnswerSnapshot = { capturedAt: "t2", validData: { NEWS: {} }, sources: [{ type: "data", id: "s2", provider: "NEWS", asOf: "t2" } as any] };
const activeA: ActiveListState = { list: listA, sources: snapA.sources, origin: { source: "TRENDING", capturedAt: listA.capturedAt } };
const activeB: ActiveListState = { list: listB, sources: snapB.sources, origin: { source: "STOCK_PICKER", capturedAt: listB.capturedAt } };

/** A committed list turn: lens=TRENDING, focus=[BFLY,WOLF], activeList=listA, snapshot=snapA. */
const priorListTurn: LastTurnFrame = {
  classification: { required_data: ["TRENDING"], primary_focus: "TRENDING", tickers: [], api_params: {}, need_api: true },
  answerIntent: "lookup",
  resultTickers: ["BFLY", "WOLF"],
  source: "TRENDING",
  snapshot: snapA,
  activeList: activeA,
};

/** A fresh-answer lens (single VALUATION/[NVDA]). */
const freshFrame: LastTurnFrame = {
  classification: { required_data: ["VALUATION"], primary_focus: "VALUATION", tickers: ["NVDA"], api_params: {}, need_api: true },
  answerIntent: "explainer",
  resultTickers: ["NVDA"],
  source: "VALUATION",
};

const PRESERVE_ALL: TurnStateTransition = {
  lens: "preserve",
  focus: "preserve",
  snapshot: "preserve",
  activeList: "preserve",
  claimState: "preserve",
  pendingAction: "preserve",
};

describe("applyTurnTransition — per-exit preserve/replace/clear table", () => {
  it("FRESH list card: lens+focus+snapshot+activeList all REPLACE", () => {
    const t = answerTurnTransition({ ...freshFrame, source: "TRENDING", resultTickers: ["BFLY", "WOLF"] }, snapA, { replace: activeA });
    const next = applyTurnTransition(null, t)!;
    expect(next.source).toBe("TRENDING");
    expect(next.resultTickers).toEqual(["BFLY", "WOLF"]);
    expect(next.snapshot).toBe(snapA);
    expect(next.activeList).toBe(activeA);
  });

  it("FRESH new entity (non-list): activeList CLEARS, snapshot REPLACES, focus REPLACES", () => {
    const t = answerTurnTransition(freshFrame, snapB, "clear");
    const next = applyTurnTransition(priorListTurn, t)!;
    expect(next.source).toBe("VALUATION");
    expect(next.resultTickers).toEqual(["NVDA"]);
    expect(next.snapshot).toBe(snapB);
    expect(next.activeList).toBeUndefined(); // old list must NOT leak into a fresh turn
  });

  it("FRESH new topic, no data fetched: snapshot CLEARS too", () => {
    const t = answerTurnTransition({ ...freshFrame, source: "GENERAL" }, undefined, "clear");
    const next = applyTurnTransition(priorListTurn, t)!;
    expect(next.snapshot).toBeUndefined();
    expect(next.activeList).toBeUndefined();
  });

  it("computed-RECALL: activeList+snapshot PRESERVE, focus REPLACES (derived winner), lens preserved, claim set", () => {
    const claim = {
      id: "c0",
      text: "BFLY rose the most, +55.87%",
      subjectTickers: ["BFLY"],
      evidenceRef: { kind: "active_list", capturedAt: listA.capturedAt },
      derivation: { kind: "list_extreme", viewId: "top_gainers", field: "changePercent", direction: "max", winnerTicker: "BFLY" },
    } as const;
    const t: TurnStateTransition = {
      lens: "preserve", // computed-RECALL keeps the parent turn's classification
      focus: { replace: ["BFLY"] },
      activeList: "preserve",
      snapshot: "preserve",
      claimState: { replace: { primaryClaimId: "c0", items: [claim] } },
      pendingAction: "clear",
    };
    const next = applyTurnTransition(priorListTurn, t)!;
    expect(next.activeList).toBe(activeA); // parent list survives → still screenable next turn
    expect(next.snapshot).toBe(snapA); // evidence survives → "数据哪来的" still answers
    expect(next.resultTickers).toEqual(["BFLY"]); // focus now the computed winner
    expect(next.source).toBe("TRENDING"); // lens preserved (no new classification)
    expect(next.claimState?.items[0].text).toBe("BFLY rose the most, +55.87%");
    expect(next.claimState?.items[0].evidenceRef).toEqual({ kind: "active_list", capturedAt: listA.capturedAt });
  });

  it("DRILL_IN (fetch single ticker): activeList PRESERVES, snapshot REPLACES", () => {
    const t = answerTurnTransition({ ...freshFrame, source: "NEWS", resultTickers: ["BFLY"] }, snapB, "preserve");
    const next = applyTurnTransition(priorListTurn, t)!;
    expect(next.activeList).toBe(activeA); // drilling one row does not drop the parent list
    expect(next.snapshot).toBe(snapB); // new evidence for the drilled ticker
    expect(next.resultTickers).toEqual(["BFLY"]);
  });

  it("REFINE_SET → single winner: activeList PRESERVES, snapshot REPLACES", () => {
    const t = answerTurnTransition({ ...freshFrame, source: "PERFORMANCE", resultTickers: ["WOLF"] }, snapB, "preserve");
    const next = applyTurnTransition(priorListTurn, t)!;
    expect(next.activeList).toBe(activeA);
    expect(next.snapshot).toBe(snapB);
  });

  it("REFINE_SET → new list: activeList+snapshot REPLACE", () => {
    const t = answerTurnTransition({ ...freshFrame, source: "STOCK_PICKER", resultTickers: ["BFLY", "WOLF"] }, snapB, { replace: activeB });
    const next = applyTurnTransition(priorListTurn, t)!;
    expect(next.activeList).toBe(activeB);
    expect(next.snapshot).toBe(snapB);
  });

  it("JUSTIFY / 来源 RECALL / CHITCHAT / TRANSFORM / 澄清 (no lens): frame UNCHANGED", () => {
    const next = applyTurnTransition(priorListTurn, PRESERVE_ALL);
    expect(next).toEqual(priorListTurn); // every field preserved
    expect(next!.activeList).toBe(activeA);
    expect(next!.snapshot).toBe(snapA);
  });

  it("turn-1 short-circuit (no prior frame, no lens): nothing to commit → null", () => {
    expect(applyTurnTransition(null, PRESERVE_ALL)).toBeNull();
  });

  it("dev guard: lens=preserve + no prior frame + a non-preserve slot → throws (no silent drop)", () => {
    expect(() => applyTurnTransition(null, { ...PRESERVE_ALL, snapshot: { replace: snapA } })).toThrow(/mis-constructed/);
    expect(() => applyTurnTransition(null, { ...PRESERVE_ALL, activeList: { replace: activeA } })).toThrow(/mis-constructed/);
  });

  it("focus CLEAR drops the referent", () => {
    const next = applyTurnTransition(priorListTurn, { ...PRESERVE_ALL, focus: "clear" })!;
    expect(next.resultTickers).toEqual([]);
  });

  it("claim CLEAR on a fresh answer turn (no conclusion carried)", () => {
    const oldClaim = {
      primaryClaimId: "c0",
      items: [{ id: "c0", text: "old claim", subjectTickers: [], evidenceRef: { kind: "active_list", capturedAt: listA.capturedAt }, derivation: { kind: "synthesized" } }],
    } as const;
    const next = applyTurnTransition({ ...priorListTurn, claimState: oldClaim }, answerTurnTransition(freshFrame, snapB, "clear"))!;
    expect(next.claimState).toBeUndefined();
  });

  it("set-choice clarification preserves answer state and records pending work", () => {
    const pending = {
      kind: "set_choice" as const,
      stage: "awaiting_criterion" as const,
      activeListCapturedAt: listA.capturedAt,
      viewId: "top_gainers",
    };
    const next = applyTurnTransition(priorListTurn, {
      ...PRESERVE_ALL,
      pendingAction: { replace: pending },
    })!;
    expect(next.activeList).toBe(activeA);
    expect(next.snapshot).toBe(snapA);
    expect(next.pendingAction).toEqual(pending);
  });

  it("normal answer transition clears a completed pending action", () => {
    const prior = {
      ...priorListTurn,
      pendingAction: {
        kind: "set_choice" as const,
        stage: "awaiting_scope" as const,
        activeListCapturedAt: listA.capturedAt,
        viewId: "top_gainers",
        criterion: "balanced" as const,
      },
    };
    const next = applyTurnTransition(prior, answerTurnTransition(freshFrame, snapB, "preserve"))!;
    expect(next.pendingAction).toBeUndefined();
  });
});
