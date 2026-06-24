import { describe, expect, it } from "vitest";
import type { ListSnapshot } from "@shared/listSnapshot";
import {
  SET_CHOICE_CANDIDATE_LIMIT,
  answerMomentumChoice,
  buildSetChoiceClassification,
  resolveSetChoiceAction,
} from "../listChoice";
import { resolvePlan } from "../resolvePlan";

function list(tickers = ["DFTX", "APGE", "ORKA"]): ListSnapshot {
  return {
    source: "TRENDING",
    capturedAt: "2026-06-22T00:00:00.000Z",
    views: [{
      id: "top_gainers",
      label: "Top Gainers",
      ranking: { kind: "metric", field: "changePercent", direction: "desc" },
      items: tickers.map((ticker, index) => ({
        ticker,
        name: ticker,
        metrics: { changePercent: [49.8, 20.1, 10.5][index] ?? 1 },
      })),
    }],
  };
}

describe("set_choice resolver", () => {
  it("recognizes contextual investment choice and asks for a criterion without classifying", () => {
    const activeList = list();
    const out = resolveSetChoiceAction("which one should i buy", activeList, undefined, "en");
    expect(out.kind).toBe("clarify");
    if (out.kind === "clarify") {
      expect(out.reason).toBe("criterion");
      expect(out.pending.stage).toBe("awaiting_criterion");
      expect(out.pending.viewId).toBe("top_gainers");
    }
  });

  it("supports broader set-choice wording", () => {
    for (const query of [
      "what would you pick",
      "is any of these worth it",
      "which of these should I buy",
      "which of them is worth buying",
      "which of those should I pick",
      "我该入手哪个",
      "这里面有值得投资的吗",
    ]) {
      expect(resolveSetChoiceAction(query, list(), undefined, "en").kind).toBe("clarify");
    }
  });

  it("candidate budget is exactly two", () => {
    expect(SET_CHOICE_CANDIDATE_LIMIT).toBe(2);
    const first = resolveSetChoiceAction("which one should I choose by balanced score", list(), undefined, "en");
    expect(first.kind).toBe("clarify");
    if (first.kind !== "clarify") throw new Error("expected scope clarification");
    expect(first.reason).toBe("scope");
    expect(first.pending.stage).toBe("awaiting_scope");

    const second = resolveSetChoiceAction("the first two", list(), first.pending, "en");
    expect(second.kind).toBe("execute");
    if (second.kind === "execute") {
      expect(second.criterion).toBe("balanced");
      expect(second.candidates.map((item) => item.ticker)).toEqual(["DFTX", "APGE"]);
    }
  });

  it("two candidates execute directly once a criterion is known", () => {
    const out = resolveSetChoiceAction("which one should I choose based on fundamentals", list(["DFTX", "APGE"]), undefined, "en");
    expect(out.kind).toBe("execute");
    if (out.kind === "execute") expect(out.candidates).toHaveLength(2);
  });

  it("momentum ranks the full view without entering the remote-comparison scope gate", () => {
    const activeList = list();
    const first = resolveSetChoiceAction("which of these should I buy", activeList, undefined, "en");
    if (first.kind !== "clarify") throw new Error("expected criterion clarification");

    const second = resolveSetChoiceAction("momentum", activeList, first.pending, "en");
    expect(second.kind).toBe("execute");
    if (second.kind === "execute") {
      expect(second.criterion).toBe("momentum");
      expect(second.candidates.map((item) => item.ticker)).toEqual(["DFTX", "APGE", "ORKA"]);
    }
  });

  it("does not bind an explicit market switch or an outside ticker", () => {
    expect(resolveSetChoiceAction("show other stocks instead", list(), undefined, "en")).toEqual({ kind: "none" });
    expect(resolveSetChoiceAction("which one should I buy, AAPL or MSFT", list(), undefined, "en")).toEqual({ kind: "none" });
    expect(resolveSetChoiceAction("which one should I choose based on DCF valuation", list(), undefined, "en").kind).toBe("clarify");
  });

  it("pending criterion advances to scope, then accepts named members", () => {
    const activeList = list();
    const first = resolveSetChoiceAction("which one should i buy", activeList, undefined, "en");
    if (first.kind !== "clarify") throw new Error("expected criterion clarification");
    const second = resolveSetChoiceAction("valuation", activeList, first.pending, "en");
    expect(second.kind).toBe("clarify");
    if (second.kind !== "clarify") throw new Error("expected scope clarification");
    const third = resolveSetChoiceAction("DFTX and ORKA", activeList, second.pending, "en");
    expect(third.kind).toBe("execute");
    if (third.kind === "execute") {
      expect(third.candidates.map((item) => item.ticker)).toEqual(["DFTX", "ORKA"]);
    }
  });

  it("does not trap an unrelated pivot behind a pending clarification", () => {
    const activeList = list();
    const first = resolveSetChoiceAction("which one should i buy", activeList, undefined, "en");
    if (first.kind !== "clarify") throw new Error("expected criterion clarification");
    expect(resolveSetChoiceAction("NVDA valuation", activeList, first.pending, "en")).toEqual({ kind: "none" });
  });

  it("momentum computation is deterministic and grounded in view metrics", () => {
    const activeList = list(["APGE", "DFTX"]);
    const view = activeList.views[0];
    const result = answerMomentumChoice(view, view.items, "en");
    expect(result.ticker).toBe("APGE");
    expect(result.answer).toContain("+49.80%");
    expect(result.answer).toContain("not a complete buy recommendation");
    // Derivation is the single source of truth for JUSTIFY's replay (no reconstruction in index.ts).
    expect(result.derivation).toMatchObject({
      kind: "list_extreme", viewId: view.id, field: "changePercent", direction: "max", winnerTicker: "APGE",
    });
    expect(result.derivation?.candidateTickers).toEqual(["APGE", "DFTX"]);
  });

  it("builds bounded synthetic classifications without classifier prompt changes", () => {
    const candidates = list(["DFTX", "APGE"]).views[0].items;
    const classification = buildSetChoiceClassification("balanced", candidates, "compare", "en");
    expect(classification.required_data).toEqual(["STOCK_PICKER"]);
    expect(classification.tickers).toEqual(["DFTX", "APGE"]);
    expect(classification.api_params.STOCK_PICKER.tickers).toEqual(["DFTX", "APGE"]);
  });

  it("fans a valuation set-choice into one VALUATION request per candidate", () => {
    const activeList = list(["DFTX", "APGE"]);
    const candidates = activeList.views[0].items;
    const effectiveQuery = "Compare DFTX and APGE by valuation";
    const classification = buildSetChoiceClassification("valuation", candidates, effectiveQuery, "en");
    const plan = resolvePlan(classification, [], effectiveQuery, activeList);

    expect(plan.fetch).toEqual([{
      source: "VALUATION",
      params: [
        { query: effectiveQuery, ticker: "DFTX" },
        { query: effectiveQuery, ticker: "APGE" },
      ],
    }]);
  });
});
