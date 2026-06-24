import { describe, it, expect } from "vitest";
import {
  activeListClaimState,
  buildClaimState,
  primaryClaim,
  resolveClaimEvidence,
  snapshotClaimState,
  type TurnClaim,
} from "../claim";
import type { ActiveListState, LastTurnFrame } from "../conversation";
import type { Source } from "../provenance";

// ── fixtures ──────────────────────────────────────────────────────────────────
const listSources: Source[] = [{ type: "data", id: "trending", provider: "TRENDING", asOf: "2026-06-21T00:00:00.000Z" }];
const snapSources: Source[] = [{ type: "data", id: "news", provider: "NEWS", asOf: "t2" }];

const activeList: ActiveListState = {
  list: { source: "TRENDING", capturedAt: "2026-06-21T00:00:00.000Z", views: [] },
  sources: listSources,
  origin: { source: "TRENDING", capturedAt: "2026-06-21T00:00:00.000Z" },
};
const extreme = { kind: "list_extreme", viewId: "top_gainers", field: "changePercent", direction: "max", winnerTicker: "BFLY" } as const;

/** A frame whose snapshot (NEWS, from a later DRILL) differs from its preserved active list. */
const frame: LastTurnFrame = {
  classification: { required_data: ["NEWS"], primary_focus: "NEWS", tickers: ["BFLY"], api_params: {}, need_api: true },
  answerIntent: "lookup",
  resultTickers: ["BFLY"],
  source: "NEWS",
  snapshot: { capturedAt: "t2", validData: { NEWS: {} }, sources: snapSources },
  activeList,
};

describe("activeListClaimState", () => {
  it("wraps one claim, binds the evidence ref + derivation + winner subject (list_extreme)", () => {
    const state = activeListClaimState("BFLY rose the most, +55.87%", activeList, extreme);
    expect(state.items).toHaveLength(1);
    expect(state.primaryClaimId).toBe(state.items[0].id);
    const claim = state.items[0];
    expect(claim.text).toBe("BFLY rose the most, +55.87%");
    expect(claim.subjectTickers).toEqual(["BFLY"]);
    expect(claim.evidenceRef).toEqual({ kind: "active_list", capturedAt: "2026-06-21T00:00:00.000Z" });
    expect(claim.derivation).toEqual(extreme);
  });

  it("subject is the boundary for an empty-domain derivation", () => {
    const ed = { kind: "list_empty_domain", viewId: "top_gainers", field: "changePercent", missingSign: "negative", boundaryTicker: "BFLY" } as const;
    const state = activeListClaimState("none are down; closest is BFLY", activeList, ed);
    expect(state.items[0].subjectTickers).toEqual(["BFLY"]);
    expect(state.items[0].derivation).toEqual(ed);
  });
});

describe("snapshotClaimState", () => {
  it("builds a synthesized claim bound to the turn snapshot (no prose one-liner)", () => {
    const state = snapshotClaimState({ capturedAt: "t2" }, ["BFLY"]);
    const claim = state.items[0];
    expect(claim.text).toBe(""); // no crisp conclusion for a synthesized answer
    expect(claim.subjectTickers).toEqual(["BFLY"]);
    expect(claim.evidenceRef).toEqual({ kind: "snapshot", capturedAt: "t2" });
    expect(claim.derivation).toEqual({ kind: "synthesized" });
  });
});

describe("buildClaimState + primaryClaim", () => {
  it("assigns positional ids and makes the first the primary", () => {
    const state = buildClaimState([
      { text: "first", subjectTickers: ["A"], evidenceRef: { kind: "active_list", capturedAt: "x" }, derivation: { kind: "synthesized" } },
      { text: "second", subjectTickers: ["B"], evidenceRef: { kind: "snapshot", capturedAt: "y" }, derivation: { kind: "synthesized" } },
    ]);
    expect(state.items.map((c) => c.id)).toEqual(["c0", "c1"]);
    expect(state.primaryClaimId).toBe("c0");
  });

  // Locks the multi-claim SELECTION seam (task-centric Phase 5 task-first synthesis). No
  // producer emits >1 claim yet; this proves the selector picks the named primary among many,
  // NOT a test of dead code.
  it("primaryClaim selects the primary among several", () => {
    const state = buildClaimState([
      { text: "first", subjectTickers: ["A"], evidenceRef: { kind: "active_list", capturedAt: "x" }, derivation: { kind: "synthesized" } },
      { text: "second", subjectTickers: ["B"], evidenceRef: { kind: "snapshot", capturedAt: "y" }, derivation: { kind: "synthesized" } },
    ]);
    expect(primaryClaim(state).text).toBe("first");
    expect(primaryClaim({ ...state, primaryClaimId: "c1" }).text).toBe("second");
  });
});

describe("resolveClaimEvidence", () => {
  const listClaim = (): TurnClaim => activeListClaimState("BFLY rose the most", activeList, extreme).items[0];

  it("active_list ref → parent list provenance, NOT the coexisting DRILL snapshot", () => {
    const ev = resolveClaimEvidence(listClaim(), frame);
    expect(ev.kind).toBe("resolved");
    if (ev.kind !== "resolved") return;
    expect(ev.sources).toBe(listSources); // TRENDING, not the NEWS snapshot
    expect(ev.capturedAt).toBe("2026-06-21T00:00:00.000Z");
  });

  // Fail-CLOSED: a stale handle must NOT fall open to the current (unrelated) slot.
  it("active_list ref whose list was since replaced (capturedAt mismatch) → unavailable", () => {
    const replaced: LastTurnFrame = {
      ...frame,
      activeList: { ...activeList, origin: { ...activeList.origin, capturedAt: "2026-06-22T00:00:00.000Z" } },
    };
    expect(resolveClaimEvidence(listClaim(), replaced).kind).toBe("unavailable");
  });

  it("active_list ref but the list was cleared → unavailable", () => {
    expect(resolveClaimEvidence(listClaim(), { ...frame, activeList: undefined }).kind).toBe("unavailable");
  });

  // Locks the dispatch seam JUSTIFY uses for drilled single-ticker claims. No production
  // writer emits snapshot-kind yet; these assert the resolver validates the snapshot's OWN
  // capturedAt (fail-closed), NOT a test of dead code.
  it("snapshot ref with matching capturedAt → resolved over snapshot.sources", () => {
    const claim: TurnClaim = { id: "c0", text: "drilled fact", subjectTickers: ["BFLY"], evidenceRef: { kind: "snapshot", capturedAt: "t2" }, derivation: { kind: "synthesized" } };
    const ev = resolveClaimEvidence(claim, frame);
    expect(ev.kind).toBe("resolved");
    if (ev.kind !== "resolved") return;
    expect(ev.sources).toBe(snapSources);
    expect(ev.capturedAt).toBe("t2");
  });

  it("snapshot ref whose snapshot was since replaced (capturedAt mismatch) → unavailable", () => {
    const claim: TurnClaim = { id: "c0", text: "drilled fact", subjectTickers: ["BFLY"], evidenceRef: { kind: "snapshot", capturedAt: "t1" }, derivation: { kind: "synthesized" } };
    expect(resolveClaimEvidence(claim, frame).kind).toBe("unavailable"); // frame.snapshot is t2
  });
});
