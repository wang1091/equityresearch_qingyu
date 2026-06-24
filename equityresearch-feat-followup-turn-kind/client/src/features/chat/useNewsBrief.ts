import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import type { Message } from "@/types";
import { LOCAL_API_BASE_URL } from "@/utils/constants";
import { UI_TEXTS, type UILanguage } from "@/utils/i18n";
import { getMessageCopyContent } from "./messageCopy";

/** De-duplicate a news message's search results + citations into brief sources. */
const buildBriefSources = (message: Message) => {
  const sources = message.newsData?.search_results || [];
  const citations = message.newsData?.citations || [];
  const seen = new Set<string>();
  return [
    ...sources.map((source, index) => ({ ...source, index })),
    ...citations.map((url, index) => ({ url, index })),
  ].filter((source) => {
    const url = source.url?.trim();
    if (!url || seen.has(url)) return false;
    seen.add(url);
    return true;
  });
};

export interface NewsBriefDeps {
  isGenerating: boolean;
  uiLanguage: UILanguage;
  allocateIds: (count: number) => number[];
  setMessages: Dispatch<SetStateAction<Message[]>>;
  setIsLoading: (value: boolean) => void;
  setIsGenerating: (value: boolean) => void;
  abortControllerRef: MutableRefObject<AbortController | null>;
  conversationIdRef: MutableRefObject<string>;
  messagesRef: MutableRefObject<Message[]>;
  persistConversationSnapshot: (conversationId: string, messages: Message[]) => Promise<unknown> | void;
  flushPendingTranslation: (lang: UILanguage) => Promise<unknown> | void;
}

/**
 * "Generate news brief" flow: posts the source NEWS answer to the dedicated
 * /api/agent/news-brief endpoint (non-streaming JSON, no classification) and
 * appends a briefData message. Moved verbatim from home.tsx.
 */
export function useNewsBrief(deps: NewsBriefDeps) {
  const handleGenerateNewsBrief = async (
    intentInfo: Message["intentInfo"],
    sourceMessage: Message,
  ) => {
    if (deps.isGenerating) {
      console.warn("⚠️ 已有回答正在生成中，请等待");
      return;
    }

    const { uiLanguage } = deps;
    const ticker = intentInfo?.tickers?.[0] || "";
    const messageContent = sourceMessage.newsData
      ? getMessageCopyContent(sourceMessage, uiLanguage)
      : sourceMessage.content;
    const briefSources = buildBriefSources(sourceMessage);
    const briefCitations = sourceMessage.newsData?.citations || [];

    const [userMessageId, loadingMessageId] = deps.allocateIds(2);
    // 创建用户消息（显示简洁版本）
    const userMessage: Message = {
      id: userMessageId,
      content: UI_TEXTS[uiLanguage].newsGenerateBrief,
      sender: "user",
      timestamp: new Date(),
    };

    deps.setMessages((prev) => [...prev, userMessage]);

    // 显示加载消息
    const loadingMessage: Message = {
      id: loadingMessageId,
      content: UI_TEXTS[uiLanguage].newsGeneratingBrief,
      sender: "agent",
      timestamp: new Date(),
      displayLanguage: uiLanguage,
      [uiLanguage === "zh" ? "contentZh" : "contentEn"]: UI_TEXTS[uiLanguage].newsGeneratingBrief,
    };
    deps.setMessages((prev) => [...prev, loadingMessage]);

    deps.setIsLoading(true);
    deps.setIsGenerating(true);

    deps.abortControllerRef.current = new AbortController();

    try {
      // 专用端点：意图已知，直接带 newsContent 调用（非流式 JSON，不走分类）。
      const response = await fetch(`${LOCAL_API_BASE_URL}/api/agent/news-brief`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          newsContent: messageContent,
          ticker: ticker || null,
          sources: briefSources,
          citations: briefCitations,
          language: uiLanguage,
        }),
        signal: deps.abortControllerRef.current?.signal,
      });

      if (!response.ok) {
        throw new Error(`API 调用失败: ${response.status}`);
      }

      const data = await response.json();

      if (!data.success || !data.brief) {
        // 降级：后端返回了非 JSON 原文则显示原文，否则报错
        deps.setMessages((prev) =>
          prev.map((msg) =>
            msg.id === loadingMessage.id
              ? { ...msg, content: data.raw || data.error || "生成简报失败" }
              : msg
          )
        );
        return;
      }

      const briefData = data.brief;

      // ✅ 移除加载消息，添加带有 briefData 的消息
      deps.setMessages((prev) =>
        prev.filter((msg) => msg.id !== loadingMessage.id).concat({
          id: loadingMessage.id,
          content: "",
          sender: "agent",
          timestamp: new Date(),
          briefData: briefData,
          displayLanguage: uiLanguage,
          [uiLanguage === "zh" ? "briefDataZh" : "briefDataEn"]: briefData,
        })
      );
      await new Promise((resolve) => setTimeout(resolve, 0));
      await deps.persistConversationSnapshot(deps.conversationIdRef.current, deps.messagesRef.current);

    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        deps.setMessages((prev) => prev.filter((msg) => msg.id !== loadingMessage.id));
        return;
      }

      console.error("生成简报失败:", error);
      deps.setMessages((prev) =>
        prev.map((msg) =>
          msg.id === loadingMessage.id
            ? {
                ...msg,
                content: `<strong>❌ 生成简报失败</strong><br>${error instanceof Error ? error.message : "未知错误"}`
              }
            : msg
        )
      );
    } finally {
      deps.setIsLoading(false);
      deps.setIsGenerating(false);
      deps.abortControllerRef.current = null;
      await new Promise((resolve) => setTimeout(resolve, 0));
      await deps.flushPendingTranslation(uiLanguage);
    }
  };

  return { handleGenerateNewsBrief };
}
