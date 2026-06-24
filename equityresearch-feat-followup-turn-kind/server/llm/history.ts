// Shared primitive for flattening conversation turns into a single labeled text
// block, for prompts that take history as REFERENCE CONTEXT rather than as native
// chat turns (the classifier's routing prompt, the Follow-Up Engine). Pure and
// stateless — windowing (slice) stays at the call site because each task wants a
// different window. See docs/LLM_HISTORY_CONTEXT_PLAN.md (B1).

export interface HistoryTurn {
  role: string; // "user" | "assistant" (anything non-"user" uses the assistant label)
  content: string;
}

export interface FormatHistoryOptions {
  /** Role labels, e.g. { user: "User", assistant: "Assistant" } (or zh, or "Agent"). */
  labels: { user: string; assistant: string };
  /** Per-turn content cap; longer content is truncated to this many chars. */
  maxChars?: number;
  /** Keep only the user's own turns. For pronoun resolution / de-dup the
   *  assistant's (long) answers add tokens but little signal. */
  userOnly?: boolean;
}

/** Format `messages` as `"<label>: <content>"` lines joined by newlines. Returns
 *  "" for empty input (or when userOnly filters everything out) so callers can
 *  fall back to a "(no history)" sentinel. */
export function formatHistoryAsText(
  messages: HistoryTurn[],
  opts: FormatHistoryOptions,
): string {
  const turns = opts.userOnly
    ? messages.filter((m) => m.role === "user")
    : messages;
  return turns
    .map((m) => {
      const label = m.role === "user" ? opts.labels.user : opts.labels.assistant;
      const content =
        opts.maxChars && m.content.length > opts.maxChars
          ? m.content.slice(0, opts.maxChars)
          : m.content;
      return `${label}: ${content}`;
    })
    .join("\n");
}
