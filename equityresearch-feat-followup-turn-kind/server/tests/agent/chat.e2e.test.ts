// End-to-end SEAM test for the agent pipeline (server/agent/index.ts → chat()).
//
// Every other agent test exercises ONE stage in isolation (classifier routing,
// apiCaller orchestration, generator) — nothing verifies that the stages are
// wired together. This pins the two seams of the full flow:
//   classify → callApis   (the routing decision's sources + params reach fetch)
//   callApis → generator  (the fetched data reaches answer generation)
// plus the need_api=false skip branch and graceful degradation.
//
// The three stages are mocked at their module boundaries (no LLM, no network);
// the in-memory conversation store, coerce step, and param builder run for real.
import { describe, it, expect, vi, beforeEach } from "vitest";

const classifyIntents = vi.fn();
const callApis = vi.fn();
const generateAnswerStream = vi.fn();
const generateUnifiedAnswer = vi.fn();
const translateTextToLanguage = vi.fn();

vi.mock("../../agent/classifier", async (orig) => ({
  ...(await orig<typeof import("../../agent/classifier")>()),
  classifyIntents: (...a: unknown[]) => classifyIntents(...a),
}));
vi.mock("../../agent/apiCaller", async (orig) => ({
  ...(await orig<typeof import("../../agent/apiCaller")>()),
  callApis: (...a: unknown[]) => callApis(...a),
}));
vi.mock("../../agent/generator", async (orig) => ({
  ...(await orig<typeof import("../../agent/generator")>()),
  generateAnswerStream: (...a: unknown[]) => generateAnswerStream(...a),
  generateUnifiedAnswer: (...a: unknown[]) => generateUnifiedAnswer(...a),
}));
vi.mock("../../translation", async (orig) => ({
  ...(await orig<typeof import("../../translation")>()),
  translateTextToLanguage: (...a: unknown[]) => translateTextToLanguage(...a),
}));

import { chat, chatStream } from "../../agent";
import { getRecentMessages, getLastTurn, replaceConversationMessages } from "../../agent/conversation";

/** turn 1 fixtures: a VALUATION turn that yields a model-source snapshot. */
const VALUATION_CLASSIFY = {
  required_data: ["VALUATION"], primary_focus: "VALUATION", tickers: ["NVDA"],
  need_api: true, api_params: { VALUATION: { ticker: "NVDA" } }, confidence: 0.9, reasoning: "",
};
const VALUATION_PAYLOAD = {
  VALUATION: { ticker: "NVDA", current_price: 100, ai_recommendation: { decision: "FAIR", chosen_method: "DCF" } },
};

beforeEach(() => {
  classifyIntents.mockReset();
  callApis.mockReset();
  generateAnswerStream.mockReset();
  generateUnifiedAnswer.mockReset();
  translateTextToLanguage.mockReset();
});

describe("agent chat() pipeline seams", () => {
  it("wires classify → callApis → generator (VALUATION/[NVDA])", async () => {
    classifyIntents.mockResolvedValue({
      required_data: ["VALUATION"],
      primary_focus: "VALUATION",
      tickers: ["NVDA"],
      need_api: true,
      api_params: { VALUATION: { ticker: "NVDA", query: "NVDA valuation" } },
      confidence: 0.95,
      reasoning: "",
    });
    const apiData = { VALUATION: { fairValue: 123 } };
    callApis.mockResolvedValue(apiData);
    generateAnswerStream.mockResolvedValue("NVDA looks fairly valued.");

    const res = await chat("conv-valuation", "NVDA valuation");

    // classify received the raw user message
    expect(classifyIntents).toHaveBeenCalledTimes(1);
    expect(classifyIntents.mock.calls[0][0]).toBe("NVDA valuation");

    // SEAM 1 — classifier decision flows into the data fetch
    expect(callApis).toHaveBeenCalledTimes(1);
    const [sources, apiParams] = callApis.mock.calls[0];
    expect(sources).toEqual(["VALUATION"]);
    expect(apiParams.VALUATION).toMatchObject({ ticker: "NVDA" });

    // SEAM 2 — fetched data flows into the generator (same object identity)
    expect(generateAnswerStream).toHaveBeenCalledTimes(1);
    const genArgs = generateAnswerStream.mock.calls[0];
    expect(genArgs[0]).toBe("NVDA valuation"); // user message
    expect(genArgs[1]).toBe(apiData); // apiData from callApis

    // final response
    expect(res.success).toBe(true);
    expect(res.answer).toBe("NVDA looks fairly valued.");
    expect(res.metadata?.requiredData).toEqual(["VALUATION"]);
    expect(res.metadata?.tickers).toEqual(["NVDA"]);
  });

  it("skips callApis when need_api is false, generator gets null apiData", async () => {
    classifyIntents.mockResolvedValue({
      required_data: ["GENERAL"],
      primary_focus: "GENERAL",
      tickers: [],
      need_api: false,
      api_params: {},
      confidence: 0.9,
      reasoning: "",
    });
    generateAnswerStream.mockResolvedValue("P/E is price-to-earnings.");

    const res = await chat("conv-general", "what is the P/E ratio?");

    expect(callApis).not.toHaveBeenCalled();
    expect(generateAnswerStream).toHaveBeenCalledTimes(1);
    expect(generateAnswerStream.mock.calls[0][1]).toBeNull(); // no apiData
    expect(res.success).toBe(true);
    expect(res.answer).toBe("P/E is price-to-earnings.");
    expect(res.metadata?.requiredData).toEqual(["GENERAL"]);
  });

  it("degrades gracefully when a downstream stage throws", async () => {
    classifyIntents.mockResolvedValue({
      required_data: ["NEWS"],
      primary_focus: "NEWS",
      tickers: ["AAPL"],
      need_api: true,
      api_params: { NEWS: { query: "Apple" } },
      confidence: 0.9,
      reasoning: "",
    });
    callApis.mockResolvedValue({ NEWS: {} });
    generateAnswerStream.mockRejectedValue(new Error("LLM down"));

    const res = await chat("conv-error", "Apple news");

    expect(res.success).toBe(false);
    expect(res.error).toBe("LLM down");
    expect(res.answer).toContain("抱歉");
  });
});

// TRANSFORM translate short-circuit (prepareTurn, the shared front-half core). A
// translate COMMAND must fire BEFORE classification and never reach a provider —
// detectTranslateCommand runs for real; only translateTextToLanguage is mocked.
// These pin the short-circuit is wired in BOTH twins (chat + chatStream): the exact
// (c)-class invariant the front-half de-dup (PLAN_CONSOLIDATION Step 0) must preserve.
describe("TRANSFORM translate short-circuit — wired in both twins", () => {
  const TRANSLATE_MSG = "翻译成中文：The Fed held rates steady amid cooling inflation.";
  const TRANSLATED = "美联储在通胀降温之际维持利率不变。";

  it("chat(): translates before classify; skips classify/callApis/generator", async () => {
    translateTextToLanguage.mockResolvedValue(TRANSLATED);

    const res = await chat("conv-xlate-chat", TRANSLATE_MSG);

    // short-circuit fired BEFORE classification — no routing, no fetch, no generation
    expect(classifyIntents).not.toHaveBeenCalled();
    expect(callApis).not.toHaveBeenCalled();
    expect(generateAnswerStream).not.toHaveBeenCalled();

    // translated the inline payload via the markdown path
    expect(translateTextToLanguage).toHaveBeenCalledTimes(1);
    expect(translateTextToLanguage.mock.calls[0][2]).toBe("markdown");

    expect(res.success).toBe(true);
    expect(res.answer).toBe(TRANSLATED);
    expect(res.metadata).toMatchObject({
      requiredData: [],
      tickers: [],
      apiCallCount: 0,
      skipDeepseek: true,
    });

    // the translation is persisted as the assistant turn
    const hist = getRecentMessages("conv-xlate-chat", 10);
    expect([...hist].reverse().find((m) => m.role === "assistant")?.content).toBe(TRANSLATED);
  });

  it("chatStream(): streams the translation, no classification event, skips provider/generator", async () => {
    translateTextToLanguage.mockResolvedValue(TRANSLATED);
    const onChunk = vi.fn();
    const onPayload = vi.fn();

    const res = await chatStream("conv-xlate-stream", TRANSLATE_MSG, onChunk, undefined, undefined, onPayload);

    expect(classifyIntents).not.toHaveBeenCalled();
    expect(callApis).not.toHaveBeenCalled();
    expect(generateAnswerStream).not.toHaveBeenCalled();
    expect(translateTextToLanguage).toHaveBeenCalledTimes(1);

    // streamed to the socket; no classification event (returns before the stream-only emit)
    expect(onChunk).toHaveBeenCalledWith(TRANSLATED);
    expect(
      onPayload.mock.calls.some((c) => (c[0] as { type?: string })?.type === "classification"),
    ).toBe(false);

    expect(res.success).toBe(true);
    expect(res.answer).toBe(TRANSLATED);
    expect(res.metadata).toMatchObject({ requiredData: [], tickers: [], apiCallCount: 0, skipDeepseek: true });

    const hist = getRecentMessages("conv-xlate-stream", 10);
    expect([...hist].reverse().find((m) => m.role === "assistant")?.content).toBe(TRANSLATED);
  });
});

// turn_kind Phase 3 — CORRECT inherits the prior turn's lens (via the lastTurn frame
// recorded centrally in prepareTurn) and swaps only the entity; CHITCHAT short-circuits
// like TRANSFORM. The CORRECT logic lives in the shared prepareTurn core, so it is
// identical across both twins; we pin chat() for the clean generateAnswerStream assertion
// and chatStream() for the both-twins wiring + the CHITCHAT short-circuit.
describe("turn_kind Phase 3 — CORRECT + CHITCHAT", () => {
  it("records a lastTurn frame after a normal answer turn", async () => {
    classifyIntents.mockResolvedValue({
      required_data: ["VALUATION"], primary_focus: "VALUATION", tickers: ["NVDA"],
      need_api: true, api_params: { VALUATION: { ticker: "NVDA" } }, confidence: 0.9, reasoning: "",
    });
    callApis.mockResolvedValue({ VALUATION: { fairValue: 1 } });
    generateAnswerStream.mockResolvedValue("NVDA.");
    await chat("conv-frame", "NVDA valuation");
    expect(getLastTurn("conv-frame")?.resultTickers).toEqual(["NVDA"]);
    expect(getLastTurn("conv-frame")?.classification.required_data).toEqual(["VALUATION"]);
  });

  it("CORRECT (chat): inherits prior VALUATION lens, swaps entity to the corrected ticker", async () => {
    // turn 1 — VALUATION on BIDU (records the frame)
    classifyIntents.mockResolvedValueOnce({
      required_data: ["VALUATION"], primary_focus: "VALUATION", tickers: ["BIDU"],
      need_api: true, api_params: { VALUATION: { ticker: "BIDU", query: "百度估值" } }, confidence: 0.9, reasoning: "",
    });
    callApis.mockResolvedValue({ VALUATION: { fairValue: 1 } });
    generateAnswerStream.mockResolvedValue("BIDU.");
    await chat("conv-correct-chat", "百度估值如何");

    // turn 2 — correction. Classifier resolves both names; CORRECT keeps the VALUATION
    // lens (NOT the new turn's NEWS) and fetches it for the corrected ticker BABA.
    callApis.mockClear();
    classifyIntents.mockResolvedValueOnce({
      required_data: ["NEWS"], primary_focus: "NEWS", tickers: ["BABA", "BIDU"],
      need_api: true, api_params: {}, confidence: 0.9, reasoning: "",
    });
    generateAnswerStream.mockResolvedValue("BABA.");
    await chat("conv-correct-chat", "我说的是阿里不是百度");

    expect(callApis).toHaveBeenCalledTimes(1);
    const [sources, apiParams] = callApis.mock.calls[0];
    expect(sources).toEqual(["VALUATION"]); // inherited lens, not NEWS
    expect(apiParams.VALUATION).toMatchObject({ ticker: "BABA" });
    expect(getLastTurn("conv-correct-chat")?.resultTickers).toEqual(["BABA"]); // frame updated
  });

  it("CORRECT (chatStream): same lens-inheritance through the streaming twin", async () => {
    // The frame now commits only AFTER turn 1's answer succeeds (atomic commit,
    // turn_kind Phase 4a). Force the legacy generateAnswerStream path (mocked) so
    // turn 1 succeeds and records its frame — the default unified generator would
    // hit a real LLM here, fail, and (correctly) leave no frame to inherit.
    const prevUnified = process.env.UNIFIED_ANSWER;
    process.env.UNIFIED_ANSWER = "false";
    try {
      classifyIntents.mockResolvedValueOnce({
        required_data: ["VALUATION", "PERFORMANCE"], primary_focus: "VALUATION", tickers: ["BIDU"],
        need_api: true, api_params: { VALUATION: { ticker: "BIDU" }, PERFORMANCE: { ticker: "BIDU" } }, confidence: 0.9, reasoning: "",
      });
      callApis.mockResolvedValue({ VALUATION: {}, PERFORMANCE: {} });
      generateAnswerStream.mockResolvedValue("BIDU.");
      await chatStream("conv-correct-stream", "百度的估值和业绩", vi.fn(), undefined, undefined, vi.fn());

      callApis.mockClear();
      classifyIntents.mockResolvedValueOnce({
        required_data: ["NEWS"], primary_focus: "NEWS", tickers: ["BABA", "BIDU"],
        need_api: true, api_params: {}, confidence: 0.9, reasoning: "",
      });
      await chatStream("conv-correct-stream", "我说的是阿里不是百度", vi.fn(), undefined, undefined, vi.fn());

      expect(callApis).toHaveBeenCalledTimes(1);
      const [sources, apiParams] = callApis.mock.calls[0];
      expect(sources).toEqual(["VALUATION", "PERFORMANCE"]); // inherited multi-intent lens
      expect(apiParams.VALUATION).toMatchObject({ ticker: "BABA" });
    } finally {
      process.env.UNIFIED_ANSWER = prevUnified;
    }
  });

  it("CHITCHAT (chat): 谢谢 → canned reply, no classify/fetch/generate", async () => {
    const res = await chat("conv-chit-chat", "谢谢");
    expect(classifyIntents).not.toHaveBeenCalled();
    expect(callApis).not.toHaveBeenCalled();
    expect(generateAnswerStream).not.toHaveBeenCalled();
    expect(res.success).toBe(true);
    expect(res.answer.toLowerCase()).toContain("welcome"); // en default in chat()
    expect(res.metadata?.apiCallCount).toBe(0);
  });

  it("CHITCHAT (chatStream): 你能做什么 → canned, streamed, no classify/fetch", async () => {
    const onChunk = vi.fn();
    const res = await chatStream("conv-chit-stream", "你能做什么", onChunk, undefined, undefined, vi.fn());
    expect(classifyIntents).not.toHaveBeenCalled();
    expect(callApis).not.toHaveBeenCalled();
    expect(generateAnswerStream).not.toHaveBeenCalled();
    expect(onChunk).toHaveBeenCalledTimes(1);
    expect(res.answer.toLowerCase()).toMatch(/valuation|estimate|market/);
  });
});

// TRENDING migrated to the generic source_card channel (docs/CARD_RENDER_MIGRATION_PLAN.md):
// with a structured sink it emits a `source_card` event (frontend renders) instead of
// streaming HTML, and persists the SAME compact list projection it feeds the live
// in-memory history — so a reloaded turn (which re-projects from the persisted line)
// routes identically. Verified live; pinned here with mocks.
describe("chatStream — TRENDING list card emits source_card (reload === live)", () => {
  it("TRENDING: emits a source_card payload and stores the projected line in live history", async () => {
    classifyIntents.mockResolvedValue({
      required_data: ["TRENDING"],
      primary_focus: "TRENDING",
      tickers: [],
      need_api: true,
      api_params: { TRENDING: { category: "all" } },
      confidence: 0.95,
      reasoning: "",
    });
    // Raw upstream trending shape (what projectListTurnToHistory + formatTrendingCard read).
    callApis.mockResolvedValue({
      TRENDING: {
        date: "2026-06-21",
        categories: [
          {
            id: "top_gainers",
            label: "Top Gainers",
            stocks: [
              { ticker: "BFLY", companyName: "Butterfly Network", changePercent: 55.87, price: 4.2 },
              { ticker: "WOLF", companyName: "Wolfspeed", changePercent: 17.91, price: 8.1 },
              { ticker: "QS", companyName: "QuantumScape", changePercent: 16.52, price: 5.0 },
            ],
          },
        ],
      },
    });

    const onChunk = vi.fn();
    const onPayload = vi.fn();
    await chatStream("conv-trending-proj", "today's top gainers", onChunk, undefined, undefined, onPayload);

    // generator is skipped on the direct-card path
    expect(generateAnswerStream).not.toHaveBeenCalled();

    // no HTML is streamed now — the frontend renders the structured payload
    expect(onChunk).not.toHaveBeenCalled();

    // the migrated channel: a source_card event carrying the raw TRENDING payload
    const card = onPayload.mock.calls
      .map((c) => c[0] as { type: string; source?: string; payload?: any })
      .find((e) => e.type === "source_card");
    expect(card).toBeTruthy();
    expect(card!.source).toBe("TRENDING");
    expect(card!.payload?.categories?.[0]?.stocks?.[0]?.ticker).toBe("BFLY");

    // reload === live: the in-memory classifier line is the compact list projection
    // (the SAME line reload re-projects from the persisted source_card envelope).
    const hist = getRecentMessages("conv-trending-proj", 10);
    const lastAssistant = [...hist].reverse().find((m) => m.role === "assistant");
    expect(lastAssistant?.content).toContain("BFLY");
    expect(lastAssistant?.content).toContain("top_gainers");
    expect(lastAssistant?.content).not.toContain("<"); // routable line, never card markup
  });
});

// turn_kind Phase 4b-0 — the exit DECISION (which activeList transition the live code
// picks), not just the pure applyTurnTransition (turnState.test). Pins two robustness
// wirings: (1) a set follow-up the classifier under-resolves still PRESERVES the parent
// list; (2) set-screen still resolves after reload via the persisted projection line.
describe("turn_kind Phase 4b-0 — activeList transition wiring (exit decision)", () => {
  const TRENDING_TURN = {
    classify: {
      required_data: ["TRENDING"], primary_focus: "TRENDING", tickers: [],
      need_api: true, api_params: { TRENDING: { category: "all" } }, confidence: 0.9, reasoning: "",
    },
    payload: {
      TRENDING: { date: "2026-06-21", categories: [{ id: "top_gainers", label: "Top Gainers", stocks: [
        { ticker: "BFLY", companyName: "Butterfly", changePercent: 55.8, price: 4 },
        { ticker: "WOLF", companyName: "Wolfspeed", changePercent: 17.9, price: 8 },
        { ticker: "QS", companyName: "QuantumScape", changePercent: 16.5, price: 5 },
      ] }] },
    },
  };

  it("断链 regression: TRENDING → 数据哪来的 (real RECALL) → 这些里哪只 reads the preserved activeList", async () => {
    // turn 1 — real chatStream TRENDING card → activeList established (>=2 routable view)
    classifyIntents.mockResolvedValueOnce(TRENDING_TURN.classify);
    callApis.mockResolvedValueOnce(TRENDING_TURN.payload);
    await chatStream("conv-4b-chain", "today's top gainers", vi.fn(), undefined, undefined, vi.fn());
    const built = getLastTurn("conv-4b-chain")?.activeList;
    expect(built?.list.views.some((v) => v.items.filter((i) => i.ticker).length >= 2)).toBe(true);

    // turn 2 — 数据哪来的: the REAL origin-RECALL short-circuit (no classify, no fetch, no
    // commit). It must NOT touch lastTurn → the activeList survives the prose turn. (This is
    // the path the old isSetScreen broke: a non-projection assistant reply between list and
    // screen. The structured activeList survives it because the short-circuit commits nothing.)
    const classifyCalls = classifyIntents.mock.calls.length;
    const fetchCalls = callApis.mock.calls.length;
    await chatStream("conv-4b-chain", "数据哪来的", vi.fn(), undefined, undefined, vi.fn());
    expect(classifyIntents.mock.calls.length).toBe(classifyCalls); // RECALL short-circuit: not classified
    expect(callApis.mock.calls.length).toBe(fetchCalls); // not fetched
    expect(getLastTurn("conv-4b-chain")?.activeList).toBe(built); // SAME object — preserved across RECALL

    // turn 3 — 这些里哪只业绩最强: real prepareTurn → resolveListOperand reads the RECALL-
    // preserved activeList → set-screen → PERFORMANCE fans out per ticker (proves the live
    // chain works end-to-end, not just by diff reasoning).
    const prevUnified = process.env.UNIFIED_ANSWER;
    process.env.UNIFIED_ANSWER = "false"; // multi-ticker → LLM path; force the mocked legacy generator
    try {
      classifyIntents.mockResolvedValueOnce({
        required_data: ["PERFORMANCE"], primary_focus: "PERFORMANCE", tickers: ["BFLY", "WOLF", "QS"],
        need_api: true, api_params: { PERFORMANCE: { query: "performance" } }, confidence: 0.9, reasoning: "",
      });
      callApis.mockResolvedValueOnce({ PERFORMANCE: [{ ticker: "BFLY" }, { ticker: "WOLF" }, { ticker: "QS" }] });
      generateAnswerStream.mockResolvedValue("…");
      await chatStream("conv-4b-chain", "这些里哪只业绩最强?", vi.fn(), undefined, undefined, vi.fn());

      const apiParams = callApis.mock.calls.at(-1)![1];
      expect(Array.isArray(apiParams.PERFORMANCE)).toBe(true); // set-screen → per-ticker fan-out
      expect(apiParams.PERFORMANCE.map((p: any) => p.ticker)).toEqual(["BFLY", "WOLF", "QS"]);
    } finally {
      process.env.UNIFIED_ANSWER = prevUnified;
    }
  });

  it("set-anaphor follow-up the classifier under-resolves (<2 tickers) PRESERVES activeList", async () => {
    // turn 1 — TRENDING list (≥2 routable) → activeList established
    classifyIntents.mockResolvedValueOnce(TRENDING_TURN.classify);
    callApis.mockResolvedValueOnce(TRENDING_TURN.payload);
    await chatStream("conv-4b-preserve", "today's top gainers", vi.fn(), undefined, undefined, vi.fn());
    expect(getLastTurn("conv-4b-preserve")?.activeList?.list.views[0].items).toHaveLength(3);

    // turn 2 — "其中…" but the classifier emits only 1 ticker → NOT a screen (needs ≥2).
    // It still REFERENCES the set → the parent list must survive (not be cleared by the miss).
    classifyIntents.mockResolvedValueOnce({
      required_data: ["PERFORMANCE"], primary_focus: "PERFORMANCE", tickers: ["BFLY"],
      need_api: true, api_params: { PERFORMANCE: { ticker: "BFLY" } }, confidence: 0.9, reasoning: "",
    });
    callApis.mockResolvedValueOnce({ PERFORMANCE: { ticker: "BFLY", value: 1 } });
    await chatStream("conv-4b-preserve", "其中涨最多的那只怎么样?", vi.fn(), undefined, undefined, vi.fn());

    const lt = getLastTurn("conv-4b-preserve");
    expect(lt?.activeList?.list.views[0].items.map((i) => i.ticker)).toEqual(["BFLY", "WOLF", "QS"]); // preserved
  });

  it("REFINE_SET: '其中市值最大' materializes the set, re-classifies w/ explicit tickers, preserves list", async () => {
    // turn 1 — TRENDING list → activeList established
    classifyIntents.mockResolvedValueOnce(TRENDING_TURN.classify);
    callApis.mockResolvedValueOnce(TRENDING_TURN.payload);
    await chatStream("conv-4b-refine", "today's top gainers", vi.fn(), undefined, undefined, vi.fn());
    const parent = getLastTurn("conv-4b-refine")?.activeList;
    expect(parent?.list.views[0].items).toHaveLength(3);

    // turn 2 — "其中市值最大" — market cap is NOT in the trending snapshot → REFINE_SET. The set
    // is materialized from view.items and the classifier is re-run on an EXPLICIT-ticker query
    // (so it routes to MARKET_DATA over the set, not a context-blind re-parse of "其中").
    const prevUnified = process.env.UNIFIED_ANSWER;
    process.env.UNIFIED_ANSWER = "false";
    try {
      classifyIntents.mockResolvedValueOnce({
        required_data: ["MARKET_DATA"], primary_focus: "MARKET_DATA", tickers: ["BFLY", "WOLF", "QS"],
        need_api: true, api_params: { MARKET_DATA: { tickers: ["BFLY", "WOLF", "QS"], queryType: "snapshot" } },
        confidence: 0.9, reasoning: "",
      });
      callApis.mockResolvedValueOnce({ MARKET_DATA: { tickers: ["BFLY", "WOLF", "QS"] } });
      generateAnswerStream.mockResolvedValue("…");
      await chatStream("conv-4b-refine", "其中市值最大的是哪只?", vi.fn(), undefined, undefined, vi.fn());

      // the re-classify saw the materialized tickers made explicit
      const reclassifyQuery = classifyIntents.mock.calls.at(-1)![0] as string;
      expect(reclassifyQuery).toContain("BFLY");
      expect(reclassifyQuery).toContain("WOLF");
      expect(reclassifyQuery).toContain("QS");
      // parent list survives the fan-out
      expect(getLastTurn("conv-4b-refine")?.activeList?.list.views[0].items.map((i) => i.ticker)).toEqual([
        "BFLY", "WOLF", "QS",
      ]);
    } finally {
      process.env.UNIFIED_ANSWER = prevUnified;
    }
  });

  it("set_choice: asks criterion, enforces the two-candidate budget, then materializes the selected view", async () => {
    classifyIntents.mockResolvedValueOnce(TRENDING_TURN.classify);
    callApis.mockResolvedValueOnce(TRENDING_TURN.payload);
    await chatStream("conv-4b-choice", "today's top gainers", vi.fn(), undefined, undefined, vi.fn());
    const parent = getLastTurn("conv-4b-choice")?.activeList;
    expect(parent?.list.views[0].items).toHaveLength(3);

    const classifyCalls = classifyIntents.mock.calls.length;
    const fetchCalls = callApis.mock.calls.length;
    const criterionChunk = vi.fn();
    await chatStream("conv-4b-choice", "which of these should i buy", criterionChunk, undefined, undefined, vi.fn());
    expect(classifyIntents.mock.calls.length).toBe(classifyCalls);
    expect(callApis.mock.calls.length).toBe(fetchCalls);
    expect(criterionChunk.mock.calls.flat().join("")).toContain("fundamentals");
    expect(getLastTurn("conv-4b-choice")?.activeList).toBe(parent);
    expect(getLastTurn("conv-4b-choice")?.pendingAction).toMatchObject({
      kind: "set_choice",
      stage: "awaiting_criterion",
      viewId: "top_gainers",
    });

    const scopeChunk = vi.fn();
    await chatStream("conv-4b-choice", "balanced score", scopeChunk, undefined, undefined, vi.fn());
    expect(classifyIntents.mock.calls.length).toBe(classifyCalls);
    expect(callApis.mock.calls.length).toBe(fetchCalls);
    expect(scopeChunk.mock.calls.flat().join("")).toContain("at most 2");
    expect(getLastTurn("conv-4b-choice")?.pendingAction).toMatchObject({
      kind: "set_choice",
      stage: "awaiting_scope",
      criterion: "balanced",
    });

    callApis.mockResolvedValueOnce({
      STOCK_PICKER: {
        mode: "comparison",
        language: "en",
        query: "compare",
        labels: ["BFLY", "WOLF"],
        results: [
          { ticker: "BFLY", finalScore: 82, recommendation: "BUY" },
          { ticker: "WOLF", finalScore: 71, recommendation: "HOLD" },
        ],
      },
    });
    await chatStream("conv-4b-choice", "the first two", vi.fn(), undefined, undefined, vi.fn());
    expect(classifyIntents.mock.calls.length).toBe(classifyCalls); // pendingAction resolved in TS
    const apiParams = callApis.mock.calls.at(-1)![1];
    expect(apiParams.STOCK_PICKER.tickers).toEqual(["BFLY", "WOLF"]);
    expect(getLastTurn("conv-4b-choice")?.pendingAction).toBeUndefined();
    expect(getLastTurn("conv-4b-choice")?.activeList?.list.source).toBe("STOCK_PICKER");
  });

  it("set_choice momentum ranks the complete view without classification, fetch, or scope clarification", async () => {
    classifyIntents.mockResolvedValueOnce(TRENDING_TURN.classify);
    callApis.mockResolvedValueOnce(TRENDING_TURN.payload);
    await chatStream("conv-4b-momentum", "today's top gainers", vi.fn(), undefined, undefined, vi.fn());
    const parent = getLastTurn("conv-4b-momentum")?.activeList;
    const classifyCalls = classifyIntents.mock.calls.length;
    const fetchCalls = callApis.mock.calls.length;

    const onChunk = vi.fn();
    await chatStream(
      "conv-4b-momentum",
      "which of these should I buy based on momentum?",
      onChunk,
      undefined,
      undefined,
      vi.fn(),
    );

    const answer = onChunk.mock.calls.flat().join("");
    expect(answer).toContain("BFLY");
    expect(answer).toContain("+55.80%");
    expect(answer).not.toContain("at most 2");
    expect(classifyIntents.mock.calls.length).toBe(classifyCalls);
    expect(callApis.mock.calls.length).toBe(fetchCalls);
    expect(getLastTurn("conv-4b-momentum")?.activeList).toBe(parent);
    expect(getLastTurn("conv-4b-momentum")?.pendingAction).toBeUndefined();
    expect(getLastTurn("conv-4b-momentum")?.resultTickers).toEqual(["BFLY"]);
  });

  it("set_choice valuation fans the chosen pair into two real VALUATION requests at callApis", async () => {
    // turn 1: a top-gainers list card establishes the activeList (BFLY/WOLF/QS).
    classifyIntents.mockResolvedValueOnce(TRENDING_TURN.classify);
    callApis.mockResolvedValueOnce(TRENDING_TURN.payload);
    await chatStream("conv-4b-val", "today's top gainers", vi.fn(), undefined, undefined, vi.fn());

    const classifyCalls = classifyIntents.mock.calls.length;
    const fetchCalls = callApis.mock.calls.length;

    // turn 2: "which of these should I buy" → criterion clarification (no classify/fetch).
    await chatStream("conv-4b-val", "which of these should I buy", vi.fn(), undefined, undefined, vi.fn());
    // turn 3: "by valuation" → 3 candidates > budget → scope clarification (still no classify/fetch).
    const scopeChunk = vi.fn();
    await chatStream("conv-4b-val", "by valuation", scopeChunk, undefined, undefined, vi.fn());
    expect(scopeChunk.mock.calls.flat().join("")).toContain("at most 2");
    expect(getLastTurn("conv-4b-val")?.pendingAction).toMatchObject({
      kind: "set_choice",
      stage: "awaiting_scope",
      criterion: "valuation",
    });
    // No classifier or fetch touched the set-choice clarification turns.
    expect(classifyIntents.mock.calls.length).toBe(classifyCalls);
    expect(callApis.mock.calls.length).toBe(fetchCalls);

    // turn 4: pick the pair → executes the VALUATION comparison (LLM path, mocked).
    callApis.mockResolvedValueOnce({
      VALUATION: [
        { ticker: "BFLY", current_price: 4, ai_recommendation: { decision: "FAIR" } },
        { ticker: "WOLF", current_price: 8, ai_recommendation: { decision: "FAIR" } },
      ],
    });
    generateUnifiedAnswer.mockResolvedValueOnce({ body: "BFLY vs WOLF on valuation." });
    await chatStream("conv-4b-val", "BFLY and WOLF", vi.fn(), undefined, undefined, vi.fn());

    // The deterministic set-choice path never classifies — it builds the plan itself.
    expect(classifyIntents.mock.calls.length).toBe(classifyCalls);
    // VALUATION reached callApis fanned per ticker: two real requests for the chosen pair.
    const [sources, apiParams] = callApis.mock.calls.at(-1)!;
    expect(sources).toEqual(["VALUATION"]);
    expect(Array.isArray(apiParams.VALUATION)).toBe(true);
    expect(apiParams.VALUATION).toHaveLength(2);
    expect(apiParams.VALUATION.map((p: any) => p.ticker)).toEqual(["BFLY", "WOLF"]);
    // The parent list survives the execution (candidates are members → preserved).
    expect(getLastTurn("conv-4b-val")?.activeList?.list.views[0].items).toHaveLength(3);
    expect(getLastTurn("conv-4b-val")?.pendingAction).toBeUndefined();
  });

  it("uncertain GENERAL keeps the dormant list; a confirmed outside entity pivot clears it", async () => {
    classifyIntents.mockResolvedValueOnce(TRENDING_TURN.classify);
    callApis.mockResolvedValueOnce(TRENDING_TURN.payload);
    await chatStream("conv-4b-uncertain", "today's top gainers", vi.fn(), undefined, undefined, vi.fn());
    const parent = getLastTurn("conv-4b-uncertain")?.activeList;

    const prevUnified = process.env.UNIFIED_ANSWER;
    process.env.UNIFIED_ANSWER = "false";
    try {
      classifyIntents.mockResolvedValueOnce({
        required_data: ["GENERAL"], primary_focus: "GENERAL", tickers: [],
        need_api: false, api_params: {}, confidence: 0.99, reasoning: "definition",
      });
      generateAnswerStream.mockResolvedValueOnce("Free cash flow is cash after capital spending.");
      await chatStream("conv-4b-uncertain", "what is free cash flow?", vi.fn(), undefined, undefined, vi.fn());
      expect(getLastTurn("conv-4b-uncertain")?.activeList).toBe(parent);

      classifyIntents.mockResolvedValueOnce(VALUATION_CLASSIFY);
      callApis.mockResolvedValueOnce(VALUATION_PAYLOAD);
      await chatStream("conv-4b-uncertain", "NVDA valuation", vi.fn(), undefined, undefined, vi.fn());
      expect(getLastTurn("conv-4b-uncertain")?.activeList).toBeUndefined();
    } finally {
      process.env.UNIFIED_ANSWER = prevUnified;
    }
  });

  it("a resolved member drill preserves the parent list", async () => {
    classifyIntents.mockResolvedValueOnce(TRENDING_TURN.classify);
    callApis.mockResolvedValueOnce(TRENDING_TURN.payload);
    await chatStream("conv-4b-member", "today's top gainers", vi.fn(), undefined, undefined, vi.fn());
    const parent = getLastTurn("conv-4b-member")?.activeList;

    classifyIntents.mockResolvedValueOnce({
      required_data: ["NEWS"], primary_focus: "NEWS", tickers: ["BFLY"],
      need_api: true, api_params: { NEWS: { query: "BFLY latest news" } }, confidence: 0.95, reasoning: "",
    });
    callApis.mockResolvedValueOnce({ NEWS: { summary: "BFLY news", articles: [] } });
    await chatStream("conv-4b-member", "BFLY news", vi.fn(), undefined, undefined, vi.fn());
    expect(getLastTurn("conv-4b-member")?.activeList).toBe(parent);
  });

  it("reload fallback: set-screen still fans out from the persisted projection line (no activeList)", async () => {
    // Reload drops the in-memory frame/activeList but the projection line survives in history.
    replaceConversationMessages("conv-4b-reload", [
      { role: "user", content: "today's top gainers", timestamp: new Date() },
      { role: "assistant", content: "[TRENDING top_gainers @2026-06-21] AAPL/Apple +5.00%; MSFT/Microsoft +4.00%", timestamp: new Date() },
    ]);
    expect(getLastTurn("conv-4b-reload")).toBeNull(); // reload cleared the structured activeList

    const prevUnified = process.env.UNIFIED_ANSWER;
    process.env.UNIFIED_ANSWER = "false"; // multi-ticker → LLM path; force the mocked legacy generator
    try {
      classifyIntents.mockResolvedValueOnce({
        required_data: ["PERFORMANCE"], primary_focus: "PERFORMANCE", tickers: ["AAPL", "MSFT"],
        need_api: true, api_params: { PERFORMANCE: { query: "performance" } }, confidence: 0.9, reasoning: "",
      });
      callApis.mockResolvedValueOnce({ PERFORMANCE: [{ ticker: "AAPL" }, { ticker: "MSFT" }] });
      generateAnswerStream.mockResolvedValue("…");
      await chatStream("conv-4b-reload", "其中哪只业绩最强?", vi.fn(), undefined, undefined, vi.fn());

      // set-screen resolved (via the reload fallback) → every ticker an independent TARGET
      // → PERFORMANCE fans out PER ticker (the array form), not a single primary+peers call.
      const apiParams = callApis.mock.calls[0][1];
      expect(Array.isArray(apiParams.PERFORMANCE)).toBe(true);
      expect(apiParams.PERFORMANCE.map((p: any) => p.ticker)).toEqual(["AAPL", "MSFT"]);
    } finally {
      process.env.UNIFIED_ANSWER = prevUnified;
    }
  });
});

// turn_kind Phase 4a — per-turn data snapshot + RECALL (origin/freshness subset).
// A data turn commits a frozen snapshot (capturedAt + typed sources) via the atomic
// commitAssistantTurn; a following "数据哪来的 / where is this from" short-circuits to a
// deterministic source list — no classify, no fetch. See docs/TURN_KIND_PHASE_4A_PLAN.md.
describe("turn_kind Phase 4a — RECALL data snapshot", () => {
  it("① data → 数据哪来的 hits RECALL: no classify/fetch turn 2, references frozen sources", async () => {
    classifyIntents.mockResolvedValueOnce(VALUATION_CLASSIFY);
    callApis.mockResolvedValueOnce(VALUATION_PAYLOAD);
    generateAnswerStream.mockResolvedValue("NVDA looks fairly valued.");
    await chat("conv-recall-1", "英伟达估值如何");
    expect(getLastTurn("conv-recall-1")?.snapshot).toBeDefined();
    expect(classifyIntents).toHaveBeenCalledTimes(1);

    // turn 2 — RECALL short-circuit
    const res = await chat("conv-recall-1", "数据哪来的");
    expect(classifyIntents).toHaveBeenCalledTimes(1); // NOT classified again
    expect(callApis).toHaveBeenCalledTimes(1); // NOT fetched again
    expect(res.metadata?.skipDeepseek).toBe(true);
    expect(res.answer).toContain("Valuation model"); // cites the frozen VALUATION source
  });

  it("② generation failure does NOT commit a frame/snapshot (prior turn retained)", async () => {
    classifyIntents.mockResolvedValueOnce(VALUATION_CLASSIFY);
    callApis.mockResolvedValueOnce(VALUATION_PAYLOAD);
    generateAnswerStream.mockResolvedValueOnce("NVDA ok.");
    await chat("conv-recall-2", "英伟达估值如何");
    const snap1 = getLastTurn("conv-recall-2")?.snapshot;
    expect(snap1).toBeDefined();

    // turn 2 — a fresh data query whose generation throws → catch → no commit
    classifyIntents.mockResolvedValueOnce({
      required_data: ["NEWS"], primary_focus: "NEWS", tickers: ["AAPL"],
      need_api: true, api_params: { NEWS: { query: "AAPL" } }, confidence: 0.9, reasoning: "",
    });
    callApis.mockResolvedValueOnce({ NEWS: { summary: "s", items: [] } });
    generateAnswerStream.mockRejectedValueOnce(new Error("LLM down"));
    const res = await chat("conv-recall-2", "苹果新闻");

    expect(res.success).toBe(false);
    // lastTurn untouched — same snapshot object + same scope as turn 1
    expect(getLastTurn("conv-recall-2")?.snapshot).toBe(snap1);
    expect(getLastTurn("conv-recall-2")?.resultTickers).toEqual(["NVDA"]);
  });

  it("③ data → 谢谢 → 数据哪来的 still recalls the data turn (CHITCHAT doesn't overwrite)", async () => {
    classifyIntents.mockResolvedValueOnce(VALUATION_CLASSIFY);
    callApis.mockResolvedValueOnce(VALUATION_PAYLOAD);
    generateAnswerStream.mockResolvedValue("NVDA ok.");
    await chat("conv-recall-3", "英伟达估值如何");

    // 谢谢 — CHITCHAT short-circuit: no classify, no frame commit
    await chat("conv-recall-3", "谢谢");
    expect(classifyIntents).toHaveBeenCalledTimes(1);
    expect(getLastTurn("conv-recall-3")?.snapshot).toBeDefined(); // still turn 1's snapshot

    // 数据哪来的 — RECALL still sees the data turn's snapshot
    const res = await chat("conv-recall-3", "数据哪来的");
    expect(classifyIntents).toHaveBeenCalledTimes(1);
    expect(res.answer).toContain("Valuation model");
  });

  it("④ fake-clock: RECALL answer's retrieval time = fetch time, not the follow-up time", async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-06-22T08:00:00.000Z"));
      classifyIntents.mockResolvedValueOnce(VALUATION_CLASSIFY);
      callApis.mockResolvedValueOnce(VALUATION_PAYLOAD);
      generateAnswerStream.mockResolvedValue("NVDA ok.");
      await chat("conv-recall-4", "英伟达估值如何");

      // follow-up arrives 3h later
      vi.setSystemTime(new Date("2026-06-22T11:00:00.000Z"));
      const res = await chat("conv-recall-4", "数据哪来的");
      expect(res.answer).toContain("2026-06-22T08:00:00.000Z"); // frozen at fetch
      expect(res.answer).not.toContain("11:00:00"); // never the recall time
    } finally {
      vi.useRealTimers();
    }
  });

  it("⑤ single-commit lands the snapshot on every chatStream branch (news_v2/source_card/html_card/generate)", async () => {
    generateAnswerStream.mockResolvedValue("generated.");

    // news_v2 — NEWS single intent + structured sink
    classifyIntents.mockResolvedValueOnce({
      required_data: ["NEWS"], primary_focus: "NEWS", tickers: ["AAPL"],
      need_api: true, api_params: { NEWS: { query: "AAPL" } }, confidence: 0.9, reasoning: "",
    });
    callApis.mockResolvedValueOnce({
      NEWS: { summary: "s", items: [{ url: "https://x.com/a", headline: "H", publisher: "X", date: "2026-06-20" }] },
    });
    await chatStream("conv-r5-news", "苹果新闻", vi.fn(), undefined, undefined, vi.fn());
    expect(getLastTurn("conv-r5-news")?.snapshot).toBeDefined();

    // source_card — VALUATION single intent + structured sink
    classifyIntents.mockResolvedValueOnce(VALUATION_CLASSIFY);
    callApis.mockResolvedValueOnce(VALUATION_PAYLOAD);
    await chatStream("conv-r5-card", "英伟达估值如何", vi.fn(), undefined, undefined, vi.fn());
    expect(getLastTurn("conv-r5-card")?.snapshot).toBeDefined();

    // html_card — TRENDING single intent, NO structured sink → HTML card path
    classifyIntents.mockResolvedValueOnce({
      required_data: ["TRENDING"], primary_focus: "TRENDING", tickers: [],
      need_api: true, api_params: { TRENDING: { category: "all" } }, confidence: 0.9, reasoning: "",
    });
    callApis.mockResolvedValueOnce({
      TRENDING: { date: "2026-06-21", categories: [{ id: "top_gainers", label: "Top Gainers", stocks: [{ ticker: "BFLY", companyName: "Butterfly", changePercent: 55.8, price: 4 }] }] },
    });
    await chatStream("conv-r5-html", "today's top gainers", vi.fn());
    expect(getLastTurn("conv-r5-html")?.snapshot).toBeDefined();

    // generate — multi-intent (not single) → LLM generation. Force legacy
    // generateAnswerStream (mocked) so we don't hit the real unified generator.
    const prevUnified = process.env.UNIFIED_ANSWER;
    process.env.UNIFIED_ANSWER = "false";
    try {
      classifyIntents.mockResolvedValueOnce({
        required_data: ["VALUATION", "PERFORMANCE"], primary_focus: "VALUATION", tickers: ["NVDA"],
        need_api: true, api_params: { VALUATION: { ticker: "NVDA" }, PERFORMANCE: { ticker: "NVDA" } }, confidence: 0.9, reasoning: "",
      });
      callApis.mockResolvedValueOnce({ VALUATION: { ticker: "NVDA", ai_recommendation: {} }, PERFORMANCE: { ticker: "NVDA", value: 1 } });
      await chatStream("conv-r5-gen", "英伟达估值和业绩", vi.fn(), undefined, undefined, vi.fn());
      expect(getLastTurn("conv-r5-gen")?.snapshot).toBeDefined();
    } finally {
      process.env.UNIFIED_ANSWER = prevUnified;
    }
  });
});

// turn_kind Phase 4b-2 — DRILL_IN. An ordinal ("第六个" / "the first one") or a bare
// member reference resolves to ONE active-list row and fetches a single-ticker drill
// (default lens = NEWS+STOCK_PRICE) — all in TS, BEFORE classification (the classifier
// cannot map an ordinal to a ticker). The parent list survives via member_reference.
describe("turn_kind Phase 4b-2 — DRILL_IN", () => {
  const TRENDING_TURN = {
    classify: {
      required_data: ["TRENDING"], primary_focus: "TRENDING", tickers: [],
      need_api: true, api_params: { TRENDING: { category: "all" } }, confidence: 0.9, reasoning: "",
    },
    payload: {
      TRENDING: { date: "2026-06-21", categories: [{ id: "top_gainers", label: "Top Gainers", stocks: [
        { ticker: "BFLY", companyName: "Butterfly", changePercent: 55.8, price: 4 },
        { ticker: "WOLF", companyName: "Wolfspeed", changePercent: 17.9, price: 8 },
        { ticker: "QS", companyName: "QuantumScape", changePercent: 16.5, price: 5 },
      ] }] },
    },
  };

  async function seedTrending(conv: string) {
    classifyIntents.mockResolvedValueOnce(TRENDING_TURN.classify);
    callApis.mockResolvedValueOnce(TRENDING_TURN.payload);
    await chatStream(conv, "today's top gainers", vi.fn(), undefined, undefined, vi.fn());
    return getLastTurn(conv)?.activeList;
  }

  it("ordinal 'the first one' drills row 1 WITHOUT classifying, fans NEWS+STOCK_PRICE, preserves the list", async () => {
    const conv = "conv-drill-ordinal";
    const parent = await seedTrending(conv);
    const classifyCalls = classifyIntents.mock.calls.length;

    const prevUnified = process.env.UNIFIED_ANSWER;
    process.env.UNIFIED_ANSWER = "false"; // multi-source → LLM path; use the mocked legacy generator
    try {
      callApis.mockResolvedValueOnce({ NEWS: { summary: "why BFLY moved", articles: [] }, STOCK_PRICE: { ticker: "BFLY", price: 4 } });
      generateAnswerStream.mockResolvedValue("BFLY drill.");
      await chatStream(conv, "tell me more about the first one", vi.fn(), undefined, undefined, vi.fn());

      // pre-classify drill: the classifier is never consulted
      expect(classifyIntents.mock.calls.length).toBe(classifyCalls);

      // the DrillPlanFactory lens reached callApis (NEWS + STOCK_PRICE for the located ticker)
      const [sources, apiParams] = callApis.mock.calls.at(-1)!;
      expect(sources).toEqual(["NEWS", "STOCK_PRICE"]);
      expect(apiParams.STOCK_PRICE).toMatchObject({ ticker: "BFLY" });

      const lt = getLastTurn(conv);
      expect(lt?.resultTickers).toEqual(["BFLY"]); // focus = the drilled row
      expect(lt?.activeList).toBe(parent); // parent list preserved across the drill
    } finally {
      process.env.UNIFIED_ANSWER = prevUnified;
    }
  });

  it("bare member symbol drills it with the default lens, parent preserved", async () => {
    const conv = "conv-drill-member";
    const parent = await seedTrending(conv);
    const classifyCalls = classifyIntents.mock.calls.length;

    const prevUnified = process.env.UNIFIED_ANSWER;
    process.env.UNIFIED_ANSWER = "false";
    try {
      callApis.mockResolvedValueOnce({ NEWS: { summary: "WOLF", articles: [] }, STOCK_PRICE: { ticker: "WOLF", price: 8 } });
      generateAnswerStream.mockResolvedValue("WOLF drill.");
      await chatStream(conv, "再说说 WOLF", vi.fn(), undefined, undefined, vi.fn());

      expect(classifyIntents.mock.calls.length).toBe(classifyCalls); // not classified
      const [sources, apiParams] = callApis.mock.calls.at(-1)!;
      expect(sources).toEqual(["NEWS", "STOCK_PRICE"]);
      expect(apiParams.STOCK_PRICE).toMatchObject({ ticker: "WOLF" });
      expect(getLastTurn(conv)?.resultTickers).toEqual(["WOLF"]);
      expect(getLastTurn(conv)?.activeList).toBe(parent);
    } finally {
      process.env.UNIFIED_ANSWER = prevUnified;
    }
  });

  it("ordinal with an unsupported intent classifies a ticker-resolved query instead of using the default lens", async () => {
    const conv = "conv-drill-classify";
    const parent = await seedTrending(conv);
    const classifyCalls = classifyIntents.mock.calls.length;

    const prevUnified = process.env.UNIFIED_ANSWER;
    process.env.UNIFIED_ANSWER = "false";
    try {
      classifyIntents.mockResolvedValueOnce({
        required_data: ["VALUATION", "NEWS", "RATING", "PERFORMANCE", "STOCK_PRICE"],
        primary_focus: "VALUATION",
        tickers: ["BFLY"],
        need_api: true,
        api_params: {
          VALUATION: { ticker: "BFLY" },
          NEWS: { query: "BFLY investment decision" },
          RATING: { ticker: "BFLY" },
          PERFORMANCE: { tickers: ["BFLY"] },
          STOCK_PRICE: { ticker: "BFLY" },
        },
        confidence: 0.9,
        reasoning: "",
      });
      callApis.mockResolvedValueOnce({
        VALUATION: {}, NEWS: {}, RATING: {}, PERFORMANCE: {}, STOCK_PRICE: {},
      });
      generateAnswerStream.mockResolvedValue("BFLY decision analysis.");

      await chatStream(conv, "Should I buy the first one?", vi.fn(), undefined, undefined, vi.fn());

      expect(classifyIntents.mock.calls.length).toBe(classifyCalls + 1);
      expect(classifyIntents.mock.calls.at(-1)![0]).toContain("BFLY");
      expect(callApis.mock.calls.at(-1)![0]).toEqual([
        "VALUATION", "NEWS", "RATING", "PERFORMANCE", "STOCK_PRICE",
      ]);
      expect(getLastTurn(conv)?.resultTickers).toEqual(["BFLY"]);
      expect(getLastTurn(conv)?.activeList).toBe(parent);
    } finally {
      process.env.UNIFIED_ANSWER = prevUnified;
    }
  });

  it("out-of-range ordinal clarifies with NO classify / NO fetch, list preserved", async () => {
    const conv = "conv-drill-oor";
    const parent = await seedTrending(conv);
    const classifyCalls = classifyIntents.mock.calls.length;
    const fetchCalls = callApis.mock.calls.length;

    const onChunk = vi.fn();
    await chatStream(conv, "第六个怎么样", onChunk, undefined, undefined, vi.fn());

    expect(classifyIntents.mock.calls.length).toBe(classifyCalls); // short-circuit, no classify
    expect(callApis.mock.calls.length).toBe(fetchCalls); // no fetch
    expect(onChunk.mock.calls.flat().join("")).toContain("3"); // "only has 3 stocks"
    expect(getLastTurn(conv)?.activeList).toBe(parent); // preserved
  });

  it("a member + an explicit lens defers to the classifier (the drill resolver owns only the bare case)", async () => {
    const conv = "conv-drill-defer";
    await seedTrending(conv);
    const classifyCalls = classifyIntents.mock.calls.length;

    classifyIntents.mockResolvedValueOnce({
      required_data: ["VALUATION"], primary_focus: "VALUATION", tickers: ["BFLY"],
      need_api: true, api_params: { VALUATION: { ticker: "BFLY" } }, confidence: 0.9, reasoning: "",
    });
    callApis.mockResolvedValueOnce({ VALUATION: { ticker: "BFLY", ai_recommendation: { decision: "FAIR" } } });
    await chatStream(conv, "BFLY valuation", vi.fn(), undefined, undefined, vi.fn());

    // explicit lens → classifier handled it (NOT the pre-classify drill short-circuit)
    expect(classifyIntents.mock.calls.length).toBe(classifyCalls + 1);
    const [sources] = callApis.mock.calls.at(-1)!;
    expect(sources).toEqual(["VALUATION"]);
    // still a member reference → parent list preserved
    expect(getLastTurn(conv)?.activeList?.list.views[0].items).toHaveLength(3);
  });
});

// turn_kind Phase 4b-1 — computed RECALL. A superlative over the active list ("其中涨最多的")
// is answered from the changePercent / finalScore already on screen — ZERO classify, ZERO
// fetch — moving focus to the winner while the parent list survives. empty_domain answers
// honestly (no winner label) when the asserted direction is absent from the domain.
describe("turn_kind Phase 4b-1 — computed RECALL", () => {
  const TRENDING_TURN = {
    classify: {
      required_data: ["TRENDING"], primary_focus: "TRENDING", tickers: [],
      need_api: true, api_params: { TRENDING: { category: "all" } }, confidence: 0.9, reasoning: "",
    },
    payload: {
      TRENDING: { date: "2026-06-21", categories: [{ id: "top_gainers", label: "Top Gainers", stocks: [
        { ticker: "BFLY", companyName: "Butterfly", changePercent: 55.8, price: 4 },
        { ticker: "WOLF", companyName: "Wolfspeed", changePercent: 17.9, price: 8 },
        { ticker: "QS", companyName: "QuantumScape", changePercent: 16.5, price: 5 },
      ] }] },
    },
  };

  async function seedTrending(conv: string) {
    classifyIntents.mockResolvedValueOnce(TRENDING_TURN.classify);
    callApis.mockResolvedValueOnce(TRENDING_TURN.payload);
    await chatStream(conv, "today's top gainers", vi.fn(), undefined, undefined, vi.fn());
    return getLastTurn(conv)?.activeList;
  }

  it("'其中涨最多的' computes the winner with NO classify / NO fetch, focus→winner, list preserved", async () => {
    const conv = "conv-computed-win";
    const parent = await seedTrending(conv);
    const classifyCalls = classifyIntents.mock.calls.length;
    const fetchCalls = callApis.mock.calls.length;

    const onChunk = vi.fn();
    await chatStream(conv, "其中涨最多的是哪只", onChunk, undefined, undefined, vi.fn());

    expect(classifyIntents.mock.calls.length).toBe(classifyCalls); // zero-prompt
    expect(callApis.mock.calls.length).toBe(fetchCalls); // zero-fetch
    const text = onChunk.mock.calls.flat().join("");
    expect(text).toContain("BFLY");
    expect(text).toContain("+55.80%");
    expect(text).toContain("TRENDING");

    const lt = getLastTurn(conv);
    expect(lt?.resultTickers).toEqual(["BFLY"]); // focus = the computed winner
    expect(lt?.activeList).toBe(parent); // parent list preserved across the compute
    const lc = lt?.claimState && lt.claimState.items[0];
    expect(lc?.text).not.toContain("Source:"); // conclusion stays separate from provenance
    expect(lc?.evidenceRef.kind).toBe("active_list"); // evidence points at the parent list
    expect(lc?.derivation.kind).toBe("list_extreme"); // derivation frozen for JUSTIFY
  });

  it("'其中跌最多的' over an all-up board → empty_domain honest answer, no fetch, list preserved", async () => {
    const conv = "conv-computed-empty";
    const parent = await seedTrending(conv);
    const classifyCalls = classifyIntents.mock.calls.length;
    const fetchCalls = callApis.mock.calls.length;

    const onChunk = vi.fn();
    await chatStream(conv, "其中跌最多的是哪只", onChunk, undefined, undefined, vi.fn());

    expect(classifyIntents.mock.calls.length).toBe(classifyCalls);
    expect(callApis.mock.calls.length).toBe(fetchCalls);
    // conversation language was set to en by the seed turn; the honest answer names no loser
    expect(onChunk.mock.calls.flat().join("")).toContain("are down right now");
    expect(getLastTurn(conv)?.activeList).toBe(parent); // preserved
  });

  it("a completed empty-domain compute clears an abandoned set-choice pending action", async () => {
    const conv = "conv-computed-clears-pending";
    await seedTrending(conv);

    await chatStream(conv, "which one should I buy", vi.fn(), undefined, undefined, vi.fn());
    expect(getLastTurn(conv)?.pendingAction?.kind).toBe("set_choice");

    await chatStream(conv, "其中跌最多的是哪只", vi.fn(), undefined, undefined, vi.fn());
    expect(getLastTurn(conv)?.pendingAction).toBeUndefined();
  });

  it("榜→DRILL→computed→来源 reads the parent list provenance, not the DRILL snapshot", async () => {
    const conv = "conv-computed-parent-source";
    await seedTrending(conv);

    const prevUnified = process.env.UNIFIED_ANSWER;
    process.env.UNIFIED_ANSWER = "false";
    try {
      callApis.mockResolvedValueOnce({
        NEWS: { summary: "why BFLY moved", articles: [] },
        STOCK_PRICE: { ticker: "BFLY", price: 4 },
      });
      generateAnswerStream.mockResolvedValue("BFLY drill.");
      await chatStream(conv, "tell me more about the first one", vi.fn(), undefined, undefined, vi.fn());

      await chatStream(conv, "其中跌最多的是哪只", vi.fn(), undefined, undefined, vi.fn());

      const onChunk = vi.fn();
      await chatStream(conv, "这些数据从哪来的", onChunk, undefined, undefined, vi.fn());
      const answer = onChunk.mock.calls.flat().join("");
      expect(answer).toContain("TRENDING");
      expect(answer).not.toContain("NEWS");
    } finally {
      process.env.UNIFIED_ANSWER = prevUnified;
    }
  });

  it("榜→computed→'为什么' replays the frozen comparison with NO classify / NO fetch", async () => {
    const conv = "conv-computed-justify";
    const parent = await seedTrending(conv);
    await chatStream(conv, "其中涨最多的是哪只", vi.fn(), undefined, undefined, vi.fn());
    const classifyCalls = classifyIntents.mock.calls.length;
    const fetchCalls = callApis.mock.calls.length;

    const onChunk = vi.fn();
    await chatStream(conv, "why do you say that", onChunk, undefined, undefined, vi.fn());

    expect(classifyIntents.mock.calls.length).toBe(classifyCalls); // zero-prompt
    expect(callApis.mock.calls.length).toBe(fetchCalls); // zero-fetch
    const answer = onChunk.mock.calls.flat().join("");
    expect(answer).toContain("BFLY"); // winner
    expect(answer).toContain("+55.80%"); // winner value, replayed from the frozen list
    expect(answer).toContain("Based on:"); // cites the list provenance
    expect(getLastTurn(conv)?.activeList).toBe(parent); // short-circuit preserves the list
  });

  it("a structured card render writes NO claim — 'why' is not mislabeled as narrative analysis", async () => {
    const conv = "conv-card-no-claim";
    await seedTrending(conv); // a TRENDING board: direct card, skips the LLM, no conclusion
    // The board has a snapshot with sources, but it is NOT a synthesized narrative → no claim.
    expect(getLastTurn(conv)?.claimState).toBeUndefined();

    // A subsequent "why" therefore does NOT short-circuit into JUSTIFY (no claim to justify).
    const onChunk = vi.fn();
    await chatStream(conv, "why do you say that", onChunk, undefined, undefined, vi.fn());
    expect(onChunk.mock.calls.flat().join("")).not.toContain("synthesized from the data retrieved");
  });

  it("榜→DRILL→'why' grounds the synthesized answer in the DRILL's provenance, NO re-fetch", async () => {
    const conv = "conv-drill-justify";
    await seedTrending(conv);

    const prevUnified = process.env.UNIFIED_ANSWER;
    process.env.UNIFIED_ANSWER = "false";
    try {
      callApis.mockResolvedValueOnce({
        NEWS: { summary: "why BFLY moved", articles: [] },
        STOCK_PRICE: { ticker: "BFLY", price: 4 },
      });
      generateAnswerStream.mockResolvedValue("BFLY drill answer.");
      await chatStream(conv, "tell me more about the first one", vi.fn(), undefined, undefined, vi.fn());
      // The drill wrote a synthesized claim bound to its snapshot.
      const drilled = getLastTurn(conv)?.claimState?.items[0];
      expect(drilled?.derivation.kind).toBe("synthesized");
      expect(drilled?.evidenceRef.kind).toBe("snapshot");

      const classifyCalls = classifyIntents.mock.calls.length;
      const fetchCalls = callApis.mock.calls.length;
      const onChunk = vi.fn();
      await chatStream(conv, "why do you say that", onChunk, undefined, undefined, vi.fn());

      expect(classifyIntents.mock.calls.length).toBe(classifyCalls); // zero-prompt
      expect(callApis.mock.calls.length).toBe(fetchCalls); // zero-fetch — no re-answer
      const answer = onChunk.mock.calls.flat().join("");
      expect(answer).toContain("synthesized from the data retrieved");
      expect(answer).toContain("Based on:"); // the DRILL's sources
    } finally {
      process.env.UNIFIED_ANSWER = prevUnified;
    }
  });
});
