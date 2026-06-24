import type { Message } from "@/types";

/**
 * The callback bundle a chat message needs to drive user actions. Grouped into
 * one object so <ChatMessage> takes a single `actions` prop instead of ~7 loose
 * handlers. The owning component (home.tsx) wires these to its state setters.
 */
export interface ChatMessageActions {
  onFeedback: (messageId: number, feedback: "positive" | "negative") => void;
  onCopy: (content: string, keyInsightsOnly?: boolean) => void;
  getMessageCopyContent: (message: Message) => string;
  onRefine: (query: string) => void;
  /** Fired by the NEWS → "Generate brief" CTA; receives the source message. */
  onGenerateNewsBrief: (message: Message) => void;
  /** Drop a follow-up into the input without sending (✏️ user_input chips). */
  onFollowUpPick: (text: string) => void;
  /** Put a follow-up into the input and send it (regular agent_query chips). */
  onFollowUpSend: (text: string) => void;
}
