// Turn claim layer (turn_kind Phase 4b). A claim is last turn's conclusion, built
// deterministically (computed argmax/min, momentum set-choice). This module is the stable
// "conclusion layer" between a turn's data and conversational follow-ups: RECALL reads its
// evidence handle ("数据哪来的"), JUSTIFY reads its derivation ("为什么"). It carries three
// things, each consumed by a different follow-up, none re-derived from raw source data:
//   - text:        the rendered conclusion;
//   - evidenceRef: WHERE the evidence lives (handle, never inlined) — for RECALL;
//   - derivation:  HOW the conclusion was reached (structured) — for JUSTIFY.
//
// Why an evidence HANDLE and not snapshot.sources: a list-derived claim ("BFLY rose the
// most") is backed by the parent list's frozen provenance, but a later DRILL replaces
// `snapshot` while preserving `activeList`. Reading snapshot.sources at RECALL time would
// then cite the DRILL's sources, not the list's. The handle dispatches on WHICH slot is the
// truth. capturedAt self-validates it (fail-CLOSED): frozen against the referenced slot at
// commit time, so if that slot is later swapped the ref no longer matches and the evidence
// is reported `unavailable` — never substituted with whatever slot is now current. Mirrors
// the `*CapturedAt` guards used for PendingComputed/PendingSetChoice.
//
// Why a structured `derivation` and not just text: RECALL only needs "where", but JUSTIFY
// needs "how". To explain "why BFLY is the biggest gainer" WITHOUT re-reading and
// re-interpreting apiData by source (the source-centric coupling task-centric forbids,
// docs/TASK_CENTRIC_QUERY_PLANNING.md §10.4), the comparison that produced the conclusion is
// frozen here. list_extreme = argmax/argmin over a frozen view's field; synthesized = an
// LLM/fetch answer with no structural derivation (JUSTIFY restates + cites, no fabricated
// causality).
//
// ClaimState wraps the claim(s) of a turn. Today every turn produces exactly ONE claim, so
// items.length === 1 and primaryClaimId points at it; the live path still flows through the
// container so its shape is exercised. Multi-claim turns arrive only with task-centric
// task-first synthesis (Phase 5): the additive seams are evidenceRef `task_results`
// (docs/TASK_CENTRIC_QUERY_PLANNING.md:426) and ClaimState.items carrying >1 claim. Until a
// producer exists, the multi-claim SELECTION path is locked by a synthetic unit test rather
// than left as untested dead code.
import type { Source } from "./provenance";
import type { ActiveListState, LastTurnFrame } from "./conversation";

/** How a conclusion was reached, frozen so JUSTIFY can explain it without re-reading data. */
export interface ListExtremeDerivation {
  kind: "list_extreme";
  viewId: string;
  field: "changePercent" | "finalScore";
  direction: "max" | "min";
  winnerTicker: string;
  /** When the comparison ran over a SUBSET of the view (momentum over user-named candidates,
   *  not the whole board), the exact rows compared — so JUSTIFY replays the same set, not the
   *  full view. Absent ⇒ the comparison was over the entire view. */
  candidateTickers?: string[];
}
/** The requested sign (a gainer needs a positive, a loser a negative) was absent from the
 *  WHOLE view — "跌最多" on an all-up board. The conclusion is "none qualify", and the
 *  boundary is only the closest (smallest gain/decline), NOT a true extreme. A distinct kind
 *  (not a flag on list_extreme) so JUSTIFY explains the domain judgment, never "X is the most"
 *  — and so `boundaryTicker`/`missingSign` read honestly instead of an overloaded winner. */
export interface ListEmptyDomainDerivation {
  kind: "list_empty_domain";
  viewId: string;
  field: "changePercent"; // only changePercent carries a sign
  missingSign: "positive" | "negative";
  boundaryTicker: string;
}
export type ClaimDerivation = ListExtremeDerivation | ListEmptyDomainDerivation | { kind: "synthesized" };

/** The subject entities a derivation is about (winner / boundary / none). */
function derivationSubjects(d: ClaimDerivation): string[] {
  if (d.kind === "list_extreme") return [d.winnerTicker];
  if (d.kind === "list_empty_domain") return [d.boundaryTicker];
  return [];
}

export interface TurnClaim {
  /** Stable within a ClaimState (assigned by position); lets a follow-up name one of many. */
  id: string;
  /** The bare conclusion text — no source lines (those are rendered separately). */
  text: string;
  /** Entities this claim is about (subject roles). For a list extreme, the winner. */
  subjectTickers: string[];
  /** Where this claim's evidence lives. Resolved by RECALL/JUSTIFY, never re-derived. */
  evidenceRef:
    | { kind: "active_list"; capturedAt: string }
    | { kind: "snapshot"; capturedAt: string };
  // future: | { kind: "task_results"; taskIds: string[] }
  /** How the conclusion was reached — consumed by JUSTIFY. */
  derivation: ClaimDerivation;
}

/** A turn's conclusion layer. One claim today (items.length === 1); >1 awaits task-centric
 *  Phase 5 task-first synthesis. primaryClaimId is the answer a bare follow-up refers to. */
export interface ClaimState {
  primaryClaimId: string;
  items: TurnClaim[];
}

/** Wrap one or more claims as a ClaimState, assigning stable positional ids and making the
 *  first the primary. Today only ever called with a single claim. */
export function buildClaimState(claims: Array<Omit<TurnClaim, "id">>): ClaimState {
  const items = claims.map((claim, index) => ({ ...claim, id: `c${index}` }));
  return { primaryClaimId: items[0].id, items };
}

/** Build the single-claim state for a conclusion derived over the active list (computed
 *  compute/empty_domain, momentum): evidence is the parent list, subjects from the derivation. */
export function activeListClaimState(
  text: string,
  activeList: ActiveListState,
  derivation: ClaimDerivation,
): ClaimState {
  return buildClaimState([
    {
      text,
      subjectTickers: derivationSubjects(derivation),
      evidenceRef: { kind: "active_list", capturedAt: activeList.origin.capturedAt },
      derivation,
    },
  ]);
}

/** Build the single-claim state for a synthesized answer (a DRILL or plain data turn): an
 *  LLM narrative with NO structural derivation. Evidence is THIS turn's snapshot; text is
 *  empty (no crisp one-liner to replay) — JUSTIFY answers provenance-focused, not by echoing
 *  prose. subjectTickers carries who the answer was about. */
export function snapshotClaimState(snapshot: { capturedAt: string }, subjectTickers: string[]): ClaimState {
  return buildClaimState([
    {
      text: "",
      subjectTickers,
      evidenceRef: { kind: "snapshot", capturedAt: snapshot.capturedAt },
      derivation: { kind: "synthesized" },
    },
  ]);
}

/** The claim a bare follow-up ("why?", "数据哪来的") refers to — the primary, else the first. */
export function primaryClaim(state: ClaimState): TurnClaim {
  return state.items.find((claim) => claim.id === state.primaryClaimId) ?? state.items[0];
}

/** The outcome of resolving a claim's evidence handle. There is no "use the default
 *  snapshot" outcome: that decision belongs to the caller (only a turn with NO claim reads
 *  the bare snapshot). A claim that HAS a handle either resolves it or is honestly
 *  unavailable — never silently fails open to whatever snapshot happens to be current. */
export type ClaimEvidence =
  | { kind: "resolved"; sources: Source[]; capturedAt: string }
  | { kind: "unavailable" };

/**
 * Resolve a claim's evidence handle, validating its capturedAt against the referenced slot
 * (fail-CLOSED): both ref kinds check that the slot they point at is still the one the claim
 * was built over. A mismatch (or a missing/source-less slot) means the original evidence is
 * gone — return `unavailable`, NEVER the current slot's data, so a claim can never cite
 * provenance it wasn't built from. Callers handle the no-claim case separately.
 */
export function resolveClaimEvidence(claim: TurnClaim, frame: LastTurnFrame): ClaimEvidence {
  if (claim.evidenceRef.kind === "active_list") {
    const al = frame.activeList;
    return al && al.origin.capturedAt === claim.evidenceRef.capturedAt && al.sources.length
      ? { kind: "resolved", sources: al.sources, capturedAt: al.origin.capturedAt }
      : { kind: "unavailable" };
  }
  const snap = frame.snapshot;
  return snap && snap.capturedAt === claim.evidenceRef.capturedAt && (snap.sources?.length ?? 0) > 0
    ? { kind: "resolved", sources: snap.sources!, capturedAt: snap.capturedAt }
    : { kind: "unavailable" };
}
