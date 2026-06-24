// Pins resolvePlan() as a faithful, equivalent merge of the scattered pre-fetch
// logic it folds together (PLAN_CONSOLIDATION_PLAN.md Step 1). Each case asserts
// the typed plan for a normalized classification — the contract Step 2 will wire
// consumers onto. Pure function, no mocks/network.
import { describe, it, expect } from "vitest";
import { resolvePlan, patchCorrectedPlan } from "../../agent/resolvePlan";
import type { LastTurnFrame } from "../../agent/conversation";
import type { ListSnapshot } from "@shared/listSnapshot";

// Mirrors normalizeClassificationPayload output (the shape resolvePlan receives).
function classification(over: Record<string, any> = {}): Record<string, any> {
  return {
    required_data: [],
    primary_focus: "GENERAL",
    tickers: [],
    need_api: true,
    api_params: {},
    confidence: 0.9,
    reasoning: "",
    ...over,
  };
}

describe("resolvePlan", () => {
  it("single VALUATION/[NVDA]: SIMPLE explainer, single-intent guard, fetch passes params through", () => {
    const plan = resolvePlan(
      classification({
        required_data: ["VALUATION"],
        primary_focus: "VALUATION",
        tickers: ["NVDA"],
        api_params: { VALUATION: { ticker: "NVDA", query: "NVDA valuation" } },
      }),
      [],
      "NVDA valuation",
    );

    expect(plan.answerMode).toBe("SIMPLE");
    expect(plan.answerIntent).toBe("explainer");
    expect(plan.needApi).toBe(true);
    expect(plan.entities).toEqual([{ symbol: "NVDA", role: "TARGET" }]);
    expect(plan.fetch).toEqual([
      { source: "VALUATION", params: { ticker: "NVDA", query: "NVDA valuation" } },
    ]);
    expect(plan.guards).toEqual({
      isSetScreen: false,
      isComparison: false,
      isMultiTicker: false,
      isSingleIntent: true,
      isRumorOnly: false,
    });
  });

  it("need_api=false general query: no fetch, lookup intent", () => {
    const plan = resolvePlan(
      classification({
        required_data: ["GENERAL"],
        primary_focus: "GENERAL",
        need_api: false,
      }),
      [],
      "what is the P/E ratio?",
    );

    expect(plan.needApi).toBe(false);
    expect(plan.fetch).toEqual([]);
    expect(plan.answerIntent).toBe("lookup");
    expect(plan.answerMode).toBe("SIMPLE");
  });

  it("explicit comparison, 2 tickers: comparison intent + comparison/multi-ticker guards", () => {
    const plan = resolvePlan(
      classification({
        required_data: ["PERFORMANCE"],
        primary_focus: "PERFORMANCE",
        tickers: ["AAPL", "MSFT"],
        api_params: { PERFORMANCE: { ticker: "AAPL", tickers: ["AAPL", "MSFT"] } },
      }),
      [],
      "compare AAPL and MSFT",
    );

    expect(plan.answerIntent).toBe("comparison");
    expect(plan.guards.isComparison).toBe(true);
    expect(plan.guards.isMultiTicker).toBe(true);
    expect(plan.guards.isSetScreen).toBe(false);
    // Comparison framing: first ticker is the subject (TARGET), the rest are peers (PEER).
    expect(plan.entities).toEqual([
      { symbol: "AAPL", role: "TARGET" },
      { symbol: "MSFT", role: "PEER" },
    ]);
    // No set-screen → only 1 TARGET → PERFORMANCE keeps the single primary+peers shape (not fanned).
    expect(plan.fetch).toEqual([
      { source: "PERFORMANCE", params: { ticker: "AAPL", tickers: ["AAPL", "MSFT"] } },
    ]);
  });

  it("set-screen over prior activeList: PERFORMANCE fans out per ticker (resolveListOperand guard)", () => {
    const activeList: ListSnapshot = {
      source: "TRENDING",
      capturedAt: "2026-06-21T00:00:00.000Z",
      views: [
        {
          id: "top_gainers",
          label: "Top Gainers",
          ranking: { kind: "metric", field: "changePercent", direction: "desc" },
          items: [
            { ticker: "AAPL", name: "Apple", metrics: { changePercent: 5 } },
            { ticker: "MSFT", name: "Microsoft", metrics: { changePercent: 4 } },
          ],
        },
      ],
    };
    const plan = resolvePlan(
      classification({
        required_data: ["PERFORMANCE"],
        primary_focus: "PERFORMANCE",
        tickers: ["AAPL", "MSFT"],
        api_params: { PERFORMANCE: { query: "performance" } },
      }),
      [],
      "which of these has the best performance?",
      activeList,
    );

    expect(plan.guards.isSetScreen).toBe(true);
    // Set-screen frames every ticker as an independent TARGET.
    expect(plan.entities).toEqual([
      { symbol: "AAPL", role: "TARGET" },
      { symbol: "MSFT", role: "TARGET" },
    ]);
    // All TARGET → PERFORMANCE fans out per ticker.
    expect(plan.fetch).toEqual([
      {
        source: "PERFORMANCE",
        params: [
          { query: "performance", ticker: "AAPL" },
          { query: "performance", ticker: "MSFT" },
        ],
      },
    ]);
  });

  it("single RUMOR: isRumorOnly guard set", () => {
    const plan = resolvePlan(
      classification({
        required_data: ["RUMOR"],
        primary_focus: "RUMOR",
        tickers: ["TSLA"],
        api_params: { RUMOR: { query: "TSLA rumor" } },
      }),
      [],
      "any rumors about TSLA?",
    );

    expect(plan.guards.isRumorOnly).toBe(true);
    expect(plan.guards.isSingleIntent).toBe(true);
  });

  it("investment-decision query: BRIEF mode + decision intent", () => {
    const plan = resolvePlan(
      classification({
        required_data: ["VALUATION", "PERFORMANCE"],
        primary_focus: "VALUATION",
        tickers: ["NVDA"],
      }),
      [],
      "should I buy NVDA?",
    );

    expect(plan.answerMode).toBe("BRIEF");
    expect(plan.answerIntent).toBe("decision");
    expect(plan.guards.isSingleIntent).toBe(false);
  });
});

describe("resolvePlan task-centric path (Phase 3 cutover gate)", () => {
  it("equivalent task plan DRIVES fetch: same source+params as legacy, taskId attached", () => {
    const plan = resolvePlan(
      classification({
        required_data: ["PERFORMANCE"],
        primary_focus: "PERFORMANCE",
        tickers: ["COST"],
        api_params: { PERFORMANCE: { ticker: "COST", query: "Costco revenue" } },
        tasks: [
          {
            question: "What is Costco's revenue?",
            entities: [{ ticker: "COST", role: "subject" }],
            metric: { family: "statement_metric", name: "revenue" },
          },
        ],
      }),
      [],
      "Costco revenue",
    );

    // Cutover active: the task plan compiled to the SAME source set + subject tickers.
    expect(plan.taskFetchActive).toBe(true);
    expect(plan.taskPlan?.status).toBe("ready");
    // Source + params are byte-identical to legacy; taskId/priority are purely additive.
    expect(plan.fetch).toEqual([
      {
        source: "PERFORMANCE",
        params: { ticker: "COST", query: "Costco revenue" },
        id: "task-1#1",
        taskId: "task-1",
        priority: 10,
      },
    ]);
  });

  it("same source+ticker but different metric stays shadow-only", () => {
    const plan = resolvePlan(
      classification({
        required_data: ["PERFORMANCE"],
        primary_focus: "PERFORMANCE",
        tickers: ["COST"],
        api_params: { PERFORMANCE: { ticker: "COST", query: "Costco revenue" } },
        tasks: [
          {
            question: "What is Costco's margin?",
            entities: [{ ticker: "COST", role: "subject" }],
            metric: { family: "statement_metric", name: "margin" },
          },
        ],
      }),
      [],
      "Costco revenue",
    );

    expect(plan.taskPlan?.status).toBe("ready");
    expect(plan.taskFetchActive).toBe(false);
    expect(plan.fetch).toEqual([
      { source: "PERFORMANCE", params: { ticker: "COST", query: "Costco revenue" } },
    ]);
  });

  it("multiple tasks sharing one source stay shadow-only instead of assigning the fetch to the first task", () => {
    const plan = resolvePlan(
      classification({
        required_data: ["PERFORMANCE"],
        primary_focus: "PERFORMANCE",
        tickers: ["COST"],
        api_params: { PERFORMANCE: { ticker: "COST", query: "Costco revenue and margin" } },
        tasks: [
          {
            question: "What is Costco's revenue?",
            entities: [{ ticker: "COST", role: "subject" }],
            metric: { family: "statement_metric", name: "revenue" },
          },
          {
            question: "What is Costco's margin?",
            entities: [{ ticker: "COST", role: "subject" }],
            metric: { family: "statement_metric", name: "margin" },
          },
        ],
      }),
      [],
      "Costco revenue and margin",
    );

    expect(plan.taskPlan?.fetch).toHaveLength(2);
    expect(plan.taskFetchActive).toBe(false);
    expect(plan.fetch.every((fetch) => fetch.taskId === undefined)).toBe(true);
  });

  it("conflict task (evidence/subject mismatch) → clarification_required → NO cutover, legacy fetch kept", () => {
    // "based on Tesla earnings call, number of Costco members" — Phase 0.5 already routes
    // this to EARNINGS at the tuple layer; the task validator additionally flags the
    // evidence/subject conflict (status clarification_required, no fetch steps). Phase 3
    // must NOT regress the fetch: legacy EARNINGS stays, the task plan rides as shadow.
    const plan = resolvePlan(
      classification({
        required_data: ["EARNINGS"],
        primary_focus: "EARNINGS",
        tickers: ["COST"],
        api_params: { EARNINGS: { ticker: "COST", topic: "transcript_qa", question: "members" } },
        tasks: [
          {
            question: "How many paid Costco memberships are there?",
            entities: [
              { ticker: "COST", role: "subject" },
              { ticker: "TSLA", role: "evidence_source" },
            ],
            metric: { family: "operating_kpi", name: "paid_memberships" },
            evidenceRelation: "unrelated",
          },
        ],
      }),
      [],
      "based on Tesla earnings call, number of Costco members",
    );

    expect(plan.taskPlan?.status).toBe("clarification_required");
    expect(plan.taskFetchActive).toBe(false);
    // Legacy fetch untouched — no taskId attached, no source dropped.
    expect(plan.fetch).toEqual([
      { source: "EARNINGS", params: { ticker: "COST", topic: "transcript_qa", question: "members" } },
    ]);
  });

  it("under-decomposition (task plan misses a legacy source) → NO cutover, both legacy sources kept", () => {
    // LLM under-emits: one statement_metric task → task plan routes only PERFORMANCE,
    // but legacy routing found PERFORMANCE+EARNINGS. The gate refuses cutover so we never
    // DROP the EARNINGS source the user's KPI ask needs.
    const plan = resolvePlan(
      classification({
        required_data: ["PERFORMANCE", "EARNINGS"],
        primary_focus: "PERFORMANCE",
        tickers: ["COST"],
        api_params: {
          PERFORMANCE: { ticker: "COST" },
          EARNINGS: { ticker: "COST", topic: "transcript_qa" },
        },
        tasks: [
          {
            question: "What is Costco's revenue growth?",
            entities: [{ ticker: "COST", role: "subject" }],
            metric: { family: "statement_metric", name: "revenue_growth" },
          },
        ],
      }),
      [],
      "Costco members vs revenue growth",
    );

    expect(plan.taskFetchActive).toBe(false);
    expect(plan.taskPlan?.requiredData).toEqual(["PERFORMANCE"]);
    expect(plan.fetch.map((f) => f.source)).toEqual(["PERFORMANCE", "EARNINGS"]);
    // No additive taskId leaked onto the legacy fetch.
    expect(plan.fetch.every((f) => f.taskId === undefined)).toBe(true);
  });

  it("ticker-set divergence (mentioned entity, §13.4) → NO cutover even with same source", () => {
    // "Tesla mentioned Costco, what did Tesla say" — task plan derives subjectTickers
    // [TSLA] (mentioned COST excluded, §13.4), but the classifier re-emitted [TSLA,COST].
    // Source set agrees (EARNINGS) and status is ready, yet the ticker sets differ → the
    // gate refuses cutover so the executed fan-out can't silently drop/keep COST.
    const plan = resolvePlan(
      classification({
        required_data: ["EARNINGS"],
        primary_focus: "EARNINGS",
        tickers: ["TSLA", "COST"],
        api_params: { EARNINGS: { ticker: "TSLA", topic: "transcript_qa" } },
        tasks: [
          {
            question: "What did Tesla say about Costco?",
            entities: [
              { ticker: "TSLA", role: "subject" },
              { ticker: "COST", role: "mentioned" },
            ],
            metric: { family: "management_commentary" },
            operation: "attribute",
          },
        ],
      }),
      [],
      "Tesla mentioned Costco in the call, what did Tesla say?",
    );

    expect(plan.taskPlan?.status).toBe("ready");
    expect(plan.taskPlan?.requiredData).toEqual(["EARNINGS"]);
    expect(plan.taskPlan?.subjectTickers).toEqual(["TSLA"]);
    expect(plan.taskFetchActive).toBe(false);
    expect(plan.fetch.every((f) => f.taskId === undefined)).toBe(true);
  });

  it("no tasks emitted → pure legacy path, no taskPlan provenance", () => {
    const plan = resolvePlan(
      classification({
        required_data: ["VALUATION"],
        tickers: ["NVDA"],
        api_params: { VALUATION: { ticker: "NVDA" } },
      }),
      [],
      "NVDA valuation",
    );
    expect(plan.taskPlan).toBeUndefined();
    expect(plan.taskFetchActive).toBeUndefined();
    expect(plan.fetch).toEqual([{ source: "VALUATION", params: { ticker: "NVDA" } }]);
  });

  it("need_api=false still compiles emitted tasks as provenance", () => {
    const plan = resolvePlan(
      classification({
        required_data: ["GENERAL"],
        primary_focus: "GENERAL",
        tickers: [],
        need_api: false,
        tasks: [
          {
            question: "What is EBITDA?",
            entities: [],
            metric: { family: "unknown", name: "EBITDA" },
          },
        ],
      }),
      [],
      "What is EBITDA?",
    );

    expect(plan.needApi).toBe(false);
    expect(plan.fetch).toEqual([]);
    expect(plan.taskPlan).toBeDefined();
    expect(plan.taskFetchActive).toBe(false);
  });
});

describe("resolvePlan set-screen materialization (turnKind #5)", () => {
  // A prior-turn leaderboard holding all three names — the exact set the user saw.
  const activeList: ListSnapshot = {
    source: "TRENDING",
    capturedAt: "2026-06-21T00:00:00.000Z",
    views: [
      {
        id: "top_gainers",
        label: "Top Gainers",
        ranking: { kind: "metric", field: "changePercent", direction: "desc" },
        items: ["BFLY", "WOLF", "QS"].map((t) => ({ ticker: t, name: t, metrics: { changePercent: 1 } })),
      },
    ],
  };

  it("materializes the FULL activeList into the fanned fetch even when the classifier under-emits", () => {
    const plan = resolvePlan(
      classification({
        required_data: ["VALUATION"],
        primary_focus: "VALUATION",
        tickers: ["BFLY", "WOLF"], // classifier echoed only 2 of the 3 on screen
        api_params: { VALUATION: [{ ticker: "BFLY", query: "v" }] },
      }),
      [],
      "这些里哪只估值低?",
      activeList,
    );

    expect(plan.operand).toMatchObject({ kind: "screen", reason: "live", sourced: "view" });
    expect(plan.entities).toEqual(
      ["BFLY", "WOLF", "QS"].map((symbol) => ({ symbol, role: "TARGET" })),
    );
    // VALUATION fans the materialized set, base params carried per ticker.
    expect(plan.fetch).toEqual([
      { source: "VALUATION", params: ["BFLY", "WOLF", "QS"].map((ticker) => ({ query: "v", ticker })) },
    ]);
  });

  it("materialized set diverges from a classifier-sourced task plan → NO false cutover", () => {
    // The task plan covers subject BFLY + peer WOLF (2); materialization screens all 3. The
    // gate gets the ACTUAL fanned set (3) as legacyTickers, so subjectTickers(2) ≠ legacy(3)
    // → refuse cutover. (Were classification.tickers passed instead, 2 == 2 could falsely
    // cut over and tag a 3-ticker fetch as "≡ a 2-ticker task".)
    const plan = resolvePlan(
      classification({
        required_data: ["PERFORMANCE"],
        primary_focus: "PERFORMANCE",
        tickers: ["BFLY", "WOLF"],
        api_params: { PERFORMANCE: { tickers: ["BFLY", "WOLF"] } },
        tasks: [
          {
            question: "Which of these has the strongest revenue?",
            entities: [
              { ticker: "BFLY", role: "subject" },
              { ticker: "WOLF", role: "peer" },
            ],
            metric: { family: "statement_metric", name: "revenue" },
          },
        ],
      }),
      [],
      "这些里哪只业绩最强?",
      activeList,
    );

    expect(plan.operand).toMatchObject({ kind: "screen", sourced: "view" });
    expect(plan.taskFetchActive).toBe(false);
    // The executed fetch is the materialized 3-ticker fan, with NO task provenance leaked.
    expect(plan.fetch.map((f) => f.source)).toEqual(["PERFORMANCE"]);
    expect((plan.fetch[0].params as { ticker: string }[]).map((p) => p.ticker)).toEqual(["BFLY", "WOLF", "QS"]);
    expect(plan.fetch.every((f) => f.taskId === undefined)).toBe(true);
  });
});

describe("patchCorrectedPlan (turn_kind Phase 3 — CORRECT)", () => {
  // Prior turn: VALUATION on BIDU (explainer lens).
  const lastTurn: LastTurnFrame = {
    classification: {
      required_data: ["VALUATION"],
      primary_focus: "VALUATION",
      tickers: ["BIDU"],
      api_params: { VALUATION: { ticker: "BIDU", query: "百度估值" } },
      need_api: true,
    },
    answerIntent: "explainer",
    resultTickers: ["BIDU"],
    source: "VALUATION",
  };

  it("inherits prior lens, swaps the entity (classifier returned both → subtract the wrong one)", () => {
    const out = patchCorrectedPlan(
      classification({ tickers: ["BABA", "BIDU"], required_data: ["NEWS"], primary_focus: "NEWS" }),
      lastTurn,
    );
    expect(out).not.toBeNull();
    // lens inherited from lastTurn (VALUATION), NOT the new turn's NEWS
    expect(out!.plan.fetch.map((f) => f.source)).toEqual(["VALUATION"]);
    expect(out!.plan.entities).toEqual([{ symbol: "BABA", role: "TARGET" }]);
    // api_params rebased onto the corrected ticker, prior query base kept
    expect(out!.plan.fetch[0].params).toMatchObject({ ticker: "BABA", query: "百度估值" });
    // coherent classification view for downstream metadata/onPayload
    expect(out!.classification.tickers).toEqual(["BABA"]);
    expect(out!.classification.required_data).toEqual(["VALUATION"]);
    expect(out!.classification.primary_focus).toBe("VALUATION");
  });

  it("classifier returned only the corrected entity → uses it as-is", () => {
    const out = patchCorrectedPlan(classification({ tickers: ["BABA"] }), lastTurn);
    expect(out!.plan.entities).toEqual([{ symbol: "BABA", role: "TARGET" }]);
    expect(out!.plan.fetch[0].params).toMatchObject({ ticker: "BABA" });
  });

  it("no resolvable entity → null (caller falls back to FRESH)", () => {
    expect(patchCorrectedPlan(classification({ tickers: [] }), lastTurn)).toBeNull();
  });

  it("inherits BRIEF when the prior turn's lens was a decision", () => {
    const out = patchCorrectedPlan(classification({ tickers: ["BABA"] }), {
      ...lastTurn,
      answerIntent: "decision",
    });
    expect(out!.plan.answerMode).toBe("BRIEF");
  });
});
