// Unit net for the conversation-history block inside the Follow-Up Engine's user
// message. The agent_answer is already passed in full separately, so the history
// is only here for de-dup ("don't re-ask"): it should be user-only and windowed.
// See docs/LLM_HISTORY_CONTEXT_PLAN.md (B3).
import { describe, it, expect } from "vitest";
import { buildFollowupsUserMessage } from "../../routes/followupsPrompts";

describe("buildFollowupsUserMessage — history block", () => {
  it("keeps the user's prior questions but drops agent answers (user-only)", () => {
    const msg = buildFollowupsUserMessage({
      user_question: "is NVDA a buy?",
      agent_answer: "SUMMARYMARK current answer body",
      conversation_history: [
        { role: "user", content: "UQ0 tell me about NVDA" },
        { role: "assistant", content: "AGENTREPLY0 here is NVDA" },
        { role: "user", content: "UQ1 what about margins?" },
        { role: "assistant", content: "AGENTREPLY1 margins are ..." },
      ],
    });

    // prior user questions are retained (the de-dup signal)
    expect(msg).toContain("UQ1 what about margins?");
    // agent answers are NOT replayed in the history block (redundant w/ agent_answer)
    expect(msg).not.toContain("AGENTREPLY0");
    expect(msg).not.toContain("AGENTREPLY1");
    // the current answer is still passed (unaffected by the history change)
    expect(msg).toContain("SUMMARYMARK");
  });

  it("windows the history to the most recent user turns", () => {
    const conversation_history = [];
    for (let i = 0; i < 10; i++) {
      conversation_history.push({ role: "user", content: `UQ${i} question number ${i}` });
      conversation_history.push({ role: "assistant", content: `A${i} answer` });
    }

    const msg = buildFollowupsUserMessage({
      user_question: "latest?",
      agent_answer: "ans",
      conversation_history,
    });

    // newest user turn kept, an old one dropped by the window
    expect(msg).toContain("UQ9 question number 9");
    expect(msg).not.toContain("UQ0 question number 0");
  });

  it("handles a fresh session with no history", () => {
    const msg = buildFollowupsUserMessage({
      user_question: "is NVDA a buy?",
      agent_answer: "body",
    });
    expect(msg).toContain("(fresh session)");
  });
});
