import type { Message } from "@/types";
import { UI_TEXTS, type UILanguage } from "@/utils/i18n";
import type { ChatMessageActions } from "./types";

interface MessageActionBarProps {
  message: Message;
  messages: Message[];
  uiLanguage: UILanguage;
  actions: ChatMessageActions;
}

/**
 * Feedback (👍/👎) + copy + copy-insights + refine bar shown beneath a finalized
 * agent answer. The render-time gate (real content, not the welcome message, not
 * mid-generation) stays in <AgentMessage>. Moved verbatim from the message map.
 */
export const MessageActionBar = ({ message, messages, uiLanguage, actions }: MessageActionBarProps) => (
  <div className="flex items-center gap-2 pt-1 flex-wrap">
    {/* Thumbs — use opacity to show selected state since emoji ignore CSS color */}
    <button
      onClick={() => actions.onFeedback(message.id, "positive")}
      title={UI_TEXTS[uiLanguage].helpful}
      className={`text-base leading-none transition-opacity select-none ${
        message.feedback === "negative" ? "opacity-20" : message.feedback === "positive" ? "opacity-100 drop-shadow-sm" : "opacity-30 hover:opacity-80"
      }`}
    >👍</button>
    <button
      onClick={() => actions.onFeedback(message.id, "negative")}
      title={UI_TEXTS[uiLanguage].notHelpful}
      className={`text-base leading-none transition-opacity select-none ${
        message.feedback === "positive" ? "opacity-20" : message.feedback === "negative" ? "opacity-100 drop-shadow-sm" : "opacity-30 hover:opacity-80"
      }`}
    >👎</button>
    <span className="text-gray-200 text-xs select-none">|</span>
    {/* Copy full */}
    <button
      onClick={() => actions.onCopy(actions.getMessageCopyContent(message))}
      className="text-[11px] text-gray-400 hover:text-gray-700 transition-colors"
      title={UI_TEXTS[uiLanguage].copyResponse}
    >
      {UI_TEXTS[uiLanguage].copy}
    </button>
    {/* Copy key insights */}
    {message.keyInsights && message.keyInsights.length > 0 && (
      <button
        onClick={() => actions.onCopy(message.content, true)}
        className="text-[11px] text-gray-400 hover:text-gray-700 transition-colors"
        title={UI_TEXTS[uiLanguage].copyKeyInsights}
      >
        {UI_TEXTS[uiLanguage].copyInsights}
      </button>
    )}
    {/* Refine — appears after thumbs down */}
    {message.feedback === "negative" && (() => {
      const msgIndex = messages.findIndex((m) => m.id === message.id);
      const prevUser = messages.slice(0, msgIndex).reverse().find((m) => m.sender === "user");
      return prevUser ? (
        <button
          onClick={() => actions.onRefine(prevUser.content)}
          className="text-[11px] text-orange-500 hover:text-orange-700 transition-colors font-medium"
        >
          {UI_TEXTS[uiLanguage].refine}
        </button>
      ) : null;
    })()}
  </div>
);
