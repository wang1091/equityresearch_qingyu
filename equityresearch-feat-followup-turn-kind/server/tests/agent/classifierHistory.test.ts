// Behavior net for how the classifier feeds conversation history to the LLM.
// There was NO coverage of this before (the routing suite passes []; classify.test
// mocks classifyIntents). This mocks the chat transport and asserts on the exact
// `messages` array classifyIntents emits. See docs/LLM_HISTORY_CONTEXT_PLAN.md.
//
//   A1 — history is injected ONCE (in the system prompt), not also echoed as a
//        separate assistant message.
//   B2 — the history window is small (~last few turns), user-only, and truncated.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const callChatWithFailover = vi.fn();

vi.mock("../../llm/chat", () => ({
  callChatWithFailover: (...a: unknown[]) => callChatWithFailover(...a),
  openAiCompatibleChatProvider: () => ({ id: "deepseek" }),
  geminiChatProvider: () => ({ id: "gemini" }),
}));

import { classifyIntents } from "../../agent/classifier";
import type { ConversationTurn } from "../../agent/classifier";

const CANNED = JSON.stringify({
  tickers: ["TSLA"],
  required_data: ["VALUATION"],
  primary_focus: "VALUATION",
  need_api: true,
  confidence: 0.9,
  reasoning: "test",
  api_params: { VALUATION: { ticker: "TSLA", query: "q" } },
});

/** The messages array handed to the transport on the most recent call. */
function lastMessages(): Array<{ role: string; content: string }> {
  return callChatWithFailover.mock.calls[0][1].messages;
}

beforeEach(() => {
  callChatWithFailover.mockReset();
  callChatWithFailover.mockResolvedValue({
    response: { choices: [{ message: { content: CANNED } }] },
    providerId: "deepseek",
  });
  vi.stubEnv("DEEPSEEK_API_KEY", "k");
  vi.stubEnv("GEMINI_API_KEY", "");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("classifier history → LLM messages", () => {
  it("A1: injects history once (system prompt only), no duplicate assistant echo", async () => {
    const history: ConversationTurn[] = [
      { role: "user", content: "HISTORYTOKEN tell me about TSLA" },
      { role: "assistant", content: "Tesla is an EV maker" },
    ];

    await classifyIntents("QUERYTOKEN what about its valuation?", history, "en");

    const messages = lastMessages();
    // exactly system + the current user turn — no separate "conversation history" turn
    expect(messages.map((m) => m.role)).toEqual(["system", "user"]);

    // the history user turn appears exactly once across ALL outgoing content
    const occurrences = messages.filter((m) =>
      m.content.includes("HISTORYTOKEN"),
    ).length;
    expect(occurrences).toBe(1);
    // ...and that one occurrence is the system prompt
    expect(messages[0].role).toBe("system");
    expect(messages[0].content).toContain("HISTORYTOKEN");

    // the CURRENT query lands in the user turn (not the system prompt) — the
    // whole point of the trailing user message after A1 reshaped the array.
    expect(messages[1].role).toBe("user");
    expect(messages[1].content).toContain("QUERYTOKEN what about its valuation?");
    expect(messages[0].content).not.toContain("QUERYTOKEN");
  });

  it("B2: window is small but KEEPS assistant turns (drops only old turns)", async () => {
    const history: ConversationTurn[] = [];
    for (let i = 0; i < 12; i++) {
      history.push({ role: "user", content: `USERMARK${i} question` });
      history.push({ role: "assistant", content: `ASSISTANTMARK${i} answer` });
    }

    await classifyIntents("what about its valuation?", history, "en");
    const system = lastMessages()[0].content;

    // newest turns are kept (carry-forward still works)
    expect(system).toContain("USERMARK11");
    // a turn well inside the OLD window (slice(-10)) is now dropped (window shrank)
    expect(system).not.toContain("USERMARK7");
    // the oldest is obviously gone
    expect(system).not.toContain("USERMARK0");
    // assistant turns ARE kept (NOT user-only) — the recent ones survive the window
    expect(system).toContain("ASSISTANTMARK11");
    expect(system).toContain("ASSISTANTMARK10");
  });

  it("B2: resolves an assistant-INTRODUCED ticker (screener → '第一个') — guards against user-only", async () => {
    // The exact regression user-only caused. Turn 1: the user names NO ticker
    // ("which tech stocks are undervalued?"); the screener/TRENDING/calendar answer
    // INTRODUCES the tickers. Turn 2 refers to one by position ("the first one's
    // valuation?"). That ticker lives ONLY in the assistant turn — so a user-only
    // window drops it and turn 2 is unresolvable. ZSCREENTICK is absent from the
    // static prompt, so a hit proves it carried over from the assistant history.
    //
    // Mirrors chat()'s accumulation: classify each turn with everything BEFORE it.
    const store: ConversationTurn[] = [];

    // turn 1 — user asks a no-ticker screen; record the assistant's answer that
    // introduces the tickers (this is what the STOCK_PICKER/TRENDING path returns).
    await classifyIntents("哪些科技股现在被低估?", [...store], "zh");
    store.push({ role: "user", content: "哪些科技股现在被低估?" });
    store.push({ role: "assistant", content: "筛选结果：被低估的有 ZSCREENTICK、F 等。" });

    // turn 2 — refer to the first pick by position; the ticker is assistant-only.
    callChatWithFailover.mockClear();
    await classifyIntents("第一个的估值呢?", [...store], "zh");
    const system = callChatWithFailover.mock.calls[0][1].messages[0].content;
    expect(system).toContain("ZSCREENTICK"); // FAILS if history is made user-only again
  });

  it("B2: carries an explicit ticker through 3 consecutive pronoun follow-ups", async () => {
    // Mirror how chat()/chatStream() accumulate history: each turn appends the
    // user msg, classifies with everything BEFORE it (history.slice(0,-1)), then
    // appends the assistant answer. The ticker is named ONCE (turn 1); every
    // follow-up uses a pronoun. This is the WORST case — assistant answers here
    // deliberately DON'T restate the ticker, so only the user turns carry it, and
    // depth is gated at ⌊WINDOW/2⌋. Real answers that restate the ticker (which is
    // why assistant turns are kept) carry it further.
    const store: ConversationTurn[] = [];
    const sawTickerOnFollowup: boolean[] = [];
    // A token that does NOT appear anywhere in the static system prompt (real
    // tickers like TSLA show up in the prompt examples and would false-positive).
    const TICK = "CARRYTICK";

    const turns = [
      `tell me about ${TICK}`, // explicit ticker
      "what is its valuation?", // pronoun 1
      "what about its risks?", // pronoun 2
      "and how is its growth?", // pronoun 3
      "who are its competitors?", // pronoun 4 — expected to LOSE the ticker
    ];

    for (let i = 0; i < turns.length; i++) {
      const prior = [...store]; // history.slice(0,-1): everything before this turn
      callChatWithFailover.mockClear();
      await classifyIntents(turns[i], prior, "en");
      if (i >= 1) {
        const system = callChatWithFailover.mock.calls[0][1].messages[0].content;
        sawTickerOnFollowup.push(system.includes(TICK));
      }
      store.push({ role: "user", content: turns[i] });
      store.push({ role: "assistant", content: `Answer ${i}: the company is doing well.` });
    }

    // 3 pronoun follow-ups (turns 2-4) still SEE the ticker in the history block...
    expect(sawTickerOnFollowup.slice(0, 3)).toEqual([true, true, true]);
    // ...the 4th (turn 5) drops out — ⌊WINDOW/2⌋ = 3 is the documented limit.
    expect(sawTickerOnFollowup[3]).toBe(false);
  });

  it("B2: truncates a long history turn", async () => {
    const long = "HEADMARK" + "z".repeat(600) + "TAILMARK";
    await classifyIntents(
      "follow up",
      [{ role: "user", content: long }],
      "en",
    );
    const system = lastMessages()[0].content;
    expect(system).toContain("HEADMARK");
    expect(system).not.toContain("TAILMARK");
  });
});
