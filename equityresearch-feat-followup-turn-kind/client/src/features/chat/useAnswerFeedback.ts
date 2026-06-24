import { useRef, type Dispatch, type MutableRefObject, type SetStateAction } from "react";
import type { Message } from "@/types";
import { LOCAL_API_BASE_URL } from "@/utils/constants";
import type { UILanguage } from "@/utils/i18n";

export interface AnswerFeedbackDeps {
  isGenerating: boolean;
  setIsGenerating: (value: boolean) => void;
  setIsLoading: (value: boolean) => void;
  setMessages: Dispatch<SetStateAction<Message[]>>;
  uiLanguage: UILanguage;
  messagesRef: MutableRefObject<Message[]>;
  flushPendingTranslation: (lang: UILanguage) => Promise<unknown> | void;
}

/**
 * Owns the "answer quality" escape hatch: tracks consecutive failures /
 * thumbs-down and, after two in a row, retries the last user query via the
 * Gemini fallback endpoint. The two counters are exposed as refs because
 * handleSendMessage resets them on a fresh query and applyAgentEvent's `done`
 * branch bumps consecutiveFailuresRef. Moved verbatim from home.tsx.
 */
export function useAnswerFeedback(deps: AnswerFeedbackDeps) {
  const consecutiveFailuresRef = useRef(0);
  const consecutiveNegativeFeedbackRef = useRef(0);

  const triggerGeminiFallback = async (query: string) => {
    if (deps.isGenerating) return;
    deps.setIsGenerating(true);
    deps.setIsLoading(true);
    const fallbackMsgId = Date.now();
    deps.setMessages((prev) => [...prev, {
      id: fallbackMsgId,
      content: "",
      sender: "agent",
      timestamp: new Date(),
      displayLanguage: deps.uiLanguage,
    }]);
    try {
      const resp = await fetch(`${LOCAL_API_BASE_URL}/api/gemini-fallback`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query, language: deps.uiLanguage }),
      });
      const data = await resp.json();
      const fallbackContent = data.success ? data.content : `<strong>❌ Fallback failed</strong><br>${data.error}`;
      deps.setMessages((prev) => prev.map((m) =>
        m.id === fallbackMsgId
          ? {
              ...m,
              content: fallbackContent,
              displayLanguage: deps.uiLanguage,
              [deps.uiLanguage === "zh" ? "contentZh" : "contentEn"]: fallbackContent,
            }
          : m
      ));
    } catch {
      const fallbackContent = "<strong>❌ Gemini fallback unavailable</strong>";
      deps.setMessages((prev) => prev.map((m) =>
        m.id === fallbackMsgId
          ? {
              ...m,
              content: fallbackContent,
              displayLanguage: deps.uiLanguage,
              [deps.uiLanguage === "zh" ? "contentZh" : "contentEn"]: fallbackContent,
            }
          : m
      ));
    } finally {
      deps.setIsLoading(false);
      deps.setIsGenerating(false);
      await new Promise((resolve) => setTimeout(resolve, 0));
      await deps.flushPendingTranslation(deps.uiLanguage);
      consecutiveNegativeFeedbackRef.current = 0;
      consecutiveFailuresRef.current = 0;
    }
  };

  const handleFeedback = (messageId: number, feedback: "positive" | "negative") => {
    deps.setMessages((prev) =>
      prev.map((msg) => msg.id === messageId ? { ...msg, feedback } : msg)
    );
    if (feedback === "negative") {
      consecutiveNegativeFeedbackRef.current += 1;
      if (consecutiveNegativeFeedbackRef.current >= 2) {
        // Find the last user query to refine
        const msgs = deps.messagesRef.current;
        const lastUserMsg = [...msgs].reverse().find((m) => m.sender === "user");
        if (lastUserMsg) triggerGeminiFallback(lastUserMsg.content);
      }
    } else {
      consecutiveNegativeFeedbackRef.current = 0;
    }
  };

  return { handleFeedback, triggerGeminiFallback, consecutiveFailuresRef, consecutiveNegativeFeedbackRef };
}
