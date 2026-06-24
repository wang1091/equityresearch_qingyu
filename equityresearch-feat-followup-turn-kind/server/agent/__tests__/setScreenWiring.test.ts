import { describe, it, expect } from "vitest";
import { resolveListOperand } from "../turnKind";
import { fanOutByRole, type EntityRole } from "../apiParamsFanout";
import type { ListSnapshot } from "@shared/listSnapshot";

// Composition test: the deterministic mirror of the live resolvePlan wiring
//   setScreen = resolveListOperand(userMessage, classification, activeList).kind === "screen"
//   role      = setScreen || i === 0 ? "TARGET" : "PEER"   (per ticker)
//   fanned    = fanOutByRole(api_params, entities, required_data)
// Guards the exact behavior the live run showed (screen → PERFORMANCE fans out; compare →
// peer single-call untouched) WITHOUT an LLM, so a future wiring regression (like (c) once
// being wired into `chat` but not `chatStream`) is caught in the unit suite.
//
// Phase 4b-0: the SET truth moved from a history-projection scan to the structured
// `activeList` (LastTurnFrame.activeList) — so these cases pass an activeList, not history.

const SET = ["BFLY", "WOLF", "QS"];

/** A prior-turn activeList (a top_gainers leaderboard) — the operable set a screen targets. */
const activeList: ListSnapshot = {
  source: "TRENDING",
  capturedAt: "2026-06-21T00:00:00.000Z",
  views: [
    {
      id: "top_gainers",
      label: "Top Gainers",
      ranking: { kind: "metric", field: "changePercent", direction: "desc" },
      items: SET.map((ticker) => ({ ticker, name: ticker, metrics: { changePercent: 1 } })),
    },
  ],
};

/** Mirror of the resolvePlan wiring (server/agent/resolvePlan.ts). On a screen the operand
 *  carries the MATERIALIZED member set (turnKind #5) — fan THAT, not classification.tickers. */
function wire(
  userMessage: string,
  list: ListSnapshot | undefined,
  classification: { tickers: string[]; required_data: string[]; api_params: Record<string, any> },
) {
  const operand = resolveListOperand(userMessage, classification, list);
  const setScreen = operand.kind === "screen";
  const fanTickers = operand.kind === "screen" ? operand.tickers : classification.tickers;
  const entities = fanTickers.map((symbol, i) => ({
    symbol,
    role: (setScreen || i === 0 ? "TARGET" : "PEER") as EntityRole,
  }));
  return fanOutByRole(classification.api_params, entities, classification.required_data);
}

describe("set-screen wiring (resolveListOperand → role → fanOutByRole)", () => {
  it("SCREEN + PERFORMANCE → fans out per ticker (the gap Phase 1 closes)", () => {
    const out = wire("这些里哪只业绩最强?", activeList, {
      tickers: SET,
      required_data: ["PERFORMANCE"],
      api_params: { PERFORMANCE: { tickers: SET } },
    })!;
    expect(out.PERFORMANCE).toEqual(SET.map((ticker) => ({ ticker })));
  });

  it("COMPARE (no set-anaphor) + PERFORMANCE → untouched peer single-call", () => {
    const out = wire("对比 AMD 和 NVDA 营收", undefined, {
      tickers: ["AMD", "NVDA"],
      required_data: ["PERFORMANCE"],
      api_params: { PERFORMANCE: { tickers: ["AMD", "NVDA"] } },
    })!;
    expect(out.PERFORMANCE).toEqual({ tickers: ["AMD", "NVDA"] }); // peer semantic preserved
  });

  it("SCREEN + VALUATION → fans out regardless of gate (safe source)", () => {
    const out = wire("这些里哪只估值最贵?", activeList, {
      tickers: SET,
      required_data: ["VALUATION"],
      api_params: { VALUATION: [{ ticker: "BFLY", query: "v" }] },
    })!;
    expect(out.VALUATION).toEqual(SET.map((ticker) => ({ query: "v", ticker })));
  });

  it("set-anaphor but NO activeList → not a screen → PERFORMANCE untouched", () => {
    const out = wire("这些里哪只业绩最强?", undefined, {
      tickers: SET,
      required_data: ["PERFORMANCE"],
      api_params: { PERFORMANCE: { tickers: SET } },
    })!;
    expect(out.PERFORMANCE).toEqual({ tickers: SET });
  });

  it("SCREEN materializes the FULL activeList even when the classifier under-emits (#5)", () => {
    // activeList holds all 3; the classifier echoed only 2 (still ≥2, so the screen gate
    // fires) → we fan all 3 so the screen covers what the user saw, not the lossy re-emit.
    const out = wire("这些里哪只业绩最强?", activeList, {
      tickers: ["BFLY", "WOLF"],
      required_data: ["PERFORMANCE", "VALUATION"],
      api_params: { PERFORMANCE: { tickers: ["BFLY", "WOLF"] }, VALUATION: [{ ticker: "BFLY", query: "v" }] },
    })!;
    expect(out.PERFORMANCE).toEqual(SET.map((ticker) => ({ ticker })));
    expect(out.VALUATION).toEqual(SET.map((ticker) => ({ query: "v", ticker })));
  });

  it("single-ticker follow-up (no fan-out at all)", () => {
    const out = wire("它的业绩怎么样?", activeList, {
      tickers: ["BFLY"],
      required_data: ["PERFORMANCE"],
      api_params: { PERFORMANCE: { ticker: "BFLY" } },
    })!;
    expect(out.PERFORMANCE).toEqual({ ticker: "BFLY" });
  });
});
