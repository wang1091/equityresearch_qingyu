import { History, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import type {
  ChatHistoryItem,
  MeResponse,
  Message,
  PersistedMessage,
} from "@/types";
import { LOCAL_API_BASE_URL } from "@/utils/constants";
import { UI_TEXTS, type UILanguage } from "@/utils/i18n";
import {
  parseEnvelope,
  serializeEnvelope,
  specFor,
  type TurnEnvelope,
} from "@shared/turnHistory";

const DATA_API_BASE_URL = `${LOCAL_API_BASE_URL}/data`;
const CHAT_HISTORY_LOG_PREFIX = "[ChatHistory][Client]";

function logInfo(event: string, data?: Record<string, unknown>) {
  console.log(`${CHAT_HISTORY_LOG_PREFIX} ${event}`, data ?? {});
}

function logWarn(event: string, data?: Record<string, unknown>) {
  console.warn(`${CHAT_HISTORY_LOG_PREFIX} ${event}`, data ?? {});
}

function logError(event: string, error: unknown, data?: Record<string, unknown>) {
  console.error(`${CHAT_HISTORY_LOG_PREFIX} ${event}`, {
    ...(data ?? {}),
    error,
  });
}

interface UseChatHistoryOptions {
  uiLanguage: UILanguage;
  isGenerating: boolean;
  initialConversationId: string;
  onConversationRestored: (conversationId: string, messages: Message[]) => void;
  onConversationDeleted: (conversationId: string, wasActive: boolean) => void;
}

interface ChatHistoryController {
  chatHistoryItems: ChatHistoryItem[];
  isHistoryLoading: boolean;
  historyLoadFailed: boolean;
  activeConversationId: string;
  setActiveConversationId: (conversationId: string) => void;
  upsertHistoryItemLocally: (conversationId: string, question: string) => void;
  persistConversationSnapshot: (
    conversationId: string,
    sourceMessages: Message[],
  ) => Promise<void>;
  handleSelectHistory: (conversationId: string) => Promise<void>;
  handleDeleteHistory: (conversationId: string) => Promise<void>;
  formatHistoryTime: (timestamp: string) => string;
}

// Pick the envelope type from the Message's structured sidecar fields. Order matters:
// a turn carries at most one of these; `text` is the bare-string fallback. Adding a
// new structured source = one more branch here + one TURN_REGISTRY entry in shared.
const envelopeForMessage = (message: Message): TurnEnvelope => {
  const base = {
    version: 1 as const,
    content: message.content,
    displayLanguage: message.displayLanguage,
  };
  if (message.briefData || message.briefDataEn || message.briefDataZh) {
    return {
      ...base,
      type: "news_brief",
      briefData: message.briefData,
      briefDataEn: message.briefDataEn,
      briefDataZh: message.briefDataZh,
    };
  }
  if (message.newsData || message.newsDataEn || message.newsDataZh) {
    return {
      ...base,
      type: "news_v2",
      newsData: message.newsData,
      newsDataEn: message.newsDataEn,
      newsDataZh: message.newsDataZh,
    };
  }
  if (message.unifiedData) {
    return { ...base, type: "unified", unifiedData: message.unifiedData };
  }
  // COMPETITIVE now rides the generic source_card channel → message.cardData below.
  if (message.cardData) {
    return { ...base, type: "source_card", cardData: message.cardData };
  }
  if (message.classifierText) {
    // HTML direct card (TRENDING/MARKET_DATA/STOCK_PICKER): keep the rendered card
    // in `content` for display; `classifierText` carries the routing projection so
    // the reloaded turn routes like the live one.
    return { ...base, type: "html_card", classifierText: message.classifierText };
  }
  return { ...base, type: "text" };
};

const serializeMessageContent = (message: Message): string =>
  serializeEnvelope(envelopeForMessage(message));

const restorePersistedMessage = (
  message: PersistedMessage,
  index: number,
): Message => {
  const base: Message = {
    id: index + 1,
    content: message.content,
    sender: message.role === "user" ? "user" : "agent",
    timestamp: new Date(message.timestamp),
  };

  if (message.role !== "assistant") {
    return base;
  }

  const env = parseEnvelope(message.content);
  if (env.type === "text") {
    return base;
  }

  // Shared registry rebuilds the type-specific display fields (newsData / briefData /
  // unifiedData …) from the envelope; merge them onto the base Message.
  return { ...base, ...(specFor(env.type).restore?.(env) ?? {}) } as Message;
};

export function useChatHistory({
  uiLanguage,
  isGenerating,
  initialConversationId,
  onConversationRestored,
  onConversationDeleted,
}: UseChatHistoryOptions): ChatHistoryController {
  const [chatHistoryItems, setChatHistoryItems] = useState<ChatHistoryItem[]>([]);
  const [isHistoryLoading, setIsHistoryLoading] = useState(true);
  const [historyLoadFailed, setHistoryLoadFailed] = useState(false);
  const [authUserId, setAuthUserId] = useState<string | null>(null);
  const [activeConversationId, setActiveConversationId] = useState(
    initialConversationId,
  );

  const formatHistoryTime = (timestamp: string): string => {
    const value = new Date(timestamp);
    if (Number.isNaN(value.getTime())) return "";

    return value.toLocaleString(uiLanguage === "zh" ? "zh-CN" : "en-US", {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  const toPersistedMessages = (sourceMessages: Message[]): PersistedMessage[] => {
    const firstUserIndex = sourceMessages.findIndex(
      (message) => message.sender === "user",
    );
    if (firstUserIndex === -1) {
      return [];
    }

    return sourceMessages
      .slice(firstUserIndex)
      .filter(
        (message) => message.sender === "user" || message.sender === "agent",
      )
      .map((message) => ({
        message,
        content: serializeMessageContent(message),
      }))
      .filter(({ content }) => content.trim().length > 0)
      .map(({ message, content }) => ({
        role: message.sender === "user" ? "user" : "assistant",
        content,
        timestamp: message.timestamp.toISOString(),
      }));
  };

  const persistConversationSnapshot = async (
    conversationId: string,
    sourceMessages: Message[],
  ) => {
    if (!authUserId) {
      logWarn("persist.skip.unauthenticated", { conversationId });
      return;
    }

    const persistedMessages = toPersistedMessages(sourceMessages);
    if (persistedMessages.length === 0) {
      logWarn("persist.skip.no_user_messages", {
        conversationId,
        totalMessages: sourceMessages.length,
      });
      return;
    }

    try {
      logInfo("persist.start", {
        userId: authUserId,
        conversationId,
        messageCount: persistedMessages.length,
      });

      const response = await fetch(`${DATA_API_BASE_URL}/chat-history`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          conversationId,
          messages: persistedMessages,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Persist failed: ${response.status} ${errorText}`);
      }

      logInfo("persist.success", {
        userId: authUserId,
        conversationId,
        messageCount: persistedMessages.length,
      });
    } catch (error) {
      logError("persist.failed", error, {
        userId: authUserId,
        conversationId,
        totalMessages: sourceMessages.length,
      });
    }
  };

  const upsertHistoryItemLocally = (conversationId: string, question: string) => {
    const trimmed = question.trim();
    if (!trimmed) {
      logWarn("local_upsert.skip.empty_question", { conversationId });
      return;
    }

    setChatHistoryItems((prev) => {
      const nowIso = new Date().toISOString();
      const existing = prev.find((item) => item.conversationId === conversationId);
      const nextItems = existing
        ? prev.map((item) =>
            item.conversationId === conversationId
              ? {
                  ...item,
                  lastUserMessage: trimmed,
                  updatedAt: nowIso,
                }
              : item,
          )
        : [
            {
              conversationId,
              title: trimmed.slice(0, 120),
              lastUserMessage: trimmed.slice(0, 500),
              updatedAt: nowIso,
              deletedAt: null,
            },
            ...prev,
          ];

      return nextItems.sort(
        (a, b) =>
          new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
      );
    });

    logInfo("local_upsert.success", {
      conversationId,
      questionLength: trimmed.length,
    });
  };

  useEffect(() => {
    let isMounted = true;

    const loadHistory = async () => {
      setIsHistoryLoading(true);
      setHistoryLoadFailed(false);

      try {
        logInfo("init.start");
        const meResponse = await fetch(`${DATA_API_BASE_URL}/me`);
        logInfo("init.me.response", { status: meResponse.status });
        if (!meResponse.ok) {
          if (meResponse.status === 401) {
            if (isMounted) {
              setAuthUserId(null);
              setChatHistoryItems([]);
            }
            logWarn("init.unauthorized");
            return;
          }
          throw new Error(`Failed to load current user: ${meResponse.status}`);
        }

        const meData: MeResponse = await meResponse.json();
        if (!isMounted) return;
        setAuthUserId(meData.userId);
        logInfo("init.me.success", { userId: meData.userId });

        const historyResponse = await fetch(
          `${DATA_API_BASE_URL}/chat-history?limit=30`,
        );
        logInfo("init.history.response", { status: historyResponse.status });
        if (!historyResponse.ok) {
          throw new Error(`Failed to load chat history: ${historyResponse.status}`);
        }

        const historyData = await historyResponse.json();
        if (!isMounted) return;

        const itemCount = Array.isArray(historyData.items) ? historyData.items.length : 0;
        setChatHistoryItems(
          Array.isArray(historyData.items) ? historyData.items : [],
        );
        logInfo("init.history.success", {
          userId: meData.userId,
          itemCount,
        });
      } catch (error) {
        logError("init.failed", error);
        if (isMounted) {
          setHistoryLoadFailed(true);
          setChatHistoryItems([]);
        }
      } finally {
        if (isMounted) {
          setIsHistoryLoading(false);
        }
        logInfo("init.finish");
      }
    };

    loadHistory();

    return () => {
      isMounted = false;
    };
  }, []);

  const handleSelectHistory = async (conversationId: string) => {
    if (!authUserId) {
      logWarn("select.skip.unauthenticated", { conversationId });
      return;
    }
    if (isGenerating) {
      logWarn("select.skip.generating", { conversationId });
      return;
    }

    try {
      logInfo("select.start", { userId: authUserId, conversationId });
      const response = await fetch(
        `${DATA_API_BASE_URL}/chat-history/${encodeURIComponent(conversationId)}`,
      );
      logInfo("select.response", {
        userId: authUserId,
        conversationId,
        status: response.status,
      });

      if (!response.ok) {
        throw new Error(`Failed to load history item: ${response.status}`);
      }

      const data = await response.json();
      const persistedMessages = Array.isArray(data.messages)
        ? (data.messages as PersistedMessage[])
        : [];

      if (persistedMessages.length === 0) {
        logWarn("select.empty_messages", { userId: authUserId, conversationId });
        return;
      }

      const restoredMessages: Message[] = persistedMessages.map(restorePersistedMessage);

      setActiveConversationId(conversationId);
      onConversationRestored(conversationId, restoredMessages);
      logInfo("select.success", {
        userId: authUserId,
        conversationId,
        messageCount: restoredMessages.length,
      });
    } catch (error) {
      logError("select.failed", error, { userId: authUserId, conversationId });
    }
  };

  const handleDeleteHistory = async (conversationId: string) => {
    if (!authUserId) {
      logWarn("delete.skip.unauthenticated", { conversationId });
      return;
    }

    try {
      logInfo("delete.start", { userId: authUserId, conversationId });
      const response = await fetch(
        `${DATA_API_BASE_URL}/chat-history/${encodeURIComponent(conversationId)}`,
        {
          method: "DELETE",
        },
      );
      logInfo("delete.response", {
        userId: authUserId,
        conversationId,
        status: response.status,
      });

      if (!response.ok && response.status !== 404) {
        throw new Error(`Failed to delete history item: ${response.status}`);
      }

      setChatHistoryItems((prev) =>
        prev.filter((item) => item.conversationId !== conversationId),
      );

      const wasActive = activeConversationId === conversationId;
      if (wasActive) {
        setActiveConversationId("");
      }
      onConversationDeleted(conversationId, wasActive);
      logInfo("delete.success", {
        userId: authUserId,
        conversationId,
        wasActive,
      });
    } catch (error) {
      logError("delete.failed", error, { userId: authUserId, conversationId });
    }
  };

  return {
    chatHistoryItems,
    isHistoryLoading,
    historyLoadFailed,
    activeConversationId,
    setActiveConversationId,
    upsertHistoryItemLocally,
    persistConversationSnapshot,
    handleSelectHistory,
    handleDeleteHistory,
    formatHistoryTime,
  };
}

interface ChatHistoryPanelProps {
  uiLanguage: UILanguage;
  chatHistoryItems: ChatHistoryItem[];
  isHistoryLoading: boolean;
  historyLoadFailed: boolean;
  activeConversationId: string;
  onSelectHistory: (conversationId: string) => void;
  onDeleteHistory: (conversationId: string) => void;
  formatHistoryTime: (timestamp: string) => string;
  compact?: boolean;
}

export function ChatHistoryPanel({
  uiLanguage,
  chatHistoryItems,
  isHistoryLoading,
  historyLoadFailed,
  activeConversationId,
  onSelectHistory,
  onDeleteHistory,
  formatHistoryTime,
  compact = false,
}: ChatHistoryPanelProps) {
  const listContainerClass = compact
    ? "max-h-52 space-y-1 overflow-y-auto pr-0.5"
    : "max-h-56 space-y-1 overflow-y-auto";

  const wrapperClass = compact
    ? "mt-1 rounded-md border border-gray-200 bg-gray-50/70 p-1.5"
    : "rounded-md border border-gray-200 bg-gray-50 p-2";

  const headerClass = compact
    ? "mb-1 flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide text-gray-500"
    : "mb-1 flex items-center gap-1 text-[11px] font-semibold text-gray-600";

  return (
    <div className={wrapperClass}>
      <div className={headerClass}>
        <History className={compact ? "h-3 w-3" : "h-3.5 w-3.5"} />
        <span className={compact ? "truncate" : ""}>
          {UI_TEXTS[uiLanguage].navChatHistory}
        </span>
      </div>

      {isHistoryLoading ? (
        <div className={compact ? "px-1 py-2 text-[10px] text-gray-400" : "py-1 text-[11px] text-gray-400"}>
          {UI_TEXTS[uiLanguage].historyLoading}
        </div>
      ) : historyLoadFailed ? (
        <div className={compact ? "px-1 py-2 text-[10px] text-red-500" : "py-1 text-[11px] text-red-500"}>
          {UI_TEXTS[uiLanguage].historyLoadFailed}
        </div>
      ) : chatHistoryItems.length === 0 ? (
        <div className={compact ? "px-1 py-2 text-[10px] text-gray-400" : "py-1 text-[11px] text-gray-400"}>
          {UI_TEXTS[uiLanguage].historyEmpty}
        </div>
      ) : (
        <div className={listContainerClass}>
          {chatHistoryItems.map((item) => {
            const isActive = item.conversationId === activeConversationId;

            return (
              <div
                key={item.conversationId}
                className={`group relative rounded-md border ${
                  compact ? "px-1.5 py-1" : "p-2"
                } ${
                  isActive
                    ? "border-indigo-300 bg-indigo-50"
                    : "border-gray-200 bg-white hover:bg-gray-100"
                }`}
                title={item.lastUserMessage}
              >
                <button
                  type="button"
                  className={compact ? "w-full pr-5 text-left" : "w-full pr-7 text-left"}
                  onClick={() => onSelectHistory(item.conversationId)}
                >
                  <div
                    className={
                      compact
                        ? "truncate text-[10px] font-medium text-gray-700"
                        : "truncate text-[11px] font-medium text-gray-700"
                    }
                  >
                    {item.lastUserMessage}
                  </div>
                  <div
                    className={
                      compact
                        ? "mt-0.5 text-[9px] text-gray-400"
                        : "mt-1 text-[10px] text-gray-400"
                    }
                  >
                    {formatHistoryTime(item.updatedAt)}
                  </div>
                </button>
                <button
                  type="button"
                  className={
                    compact
                      ? "absolute right-1 top-1 hidden rounded p-0.5 text-gray-400 hover:bg-red-50 hover:text-red-600 group-hover:block"
                      : "absolute right-1.5 top-1.5 rounded p-1 text-gray-400 hover:bg-red-50 hover:text-red-600"
                  }
                  title={UI_TEXTS[uiLanguage].historyDelete}
                  onClick={(event) => {
                    event.stopPropagation();
                    onDeleteHistory(item.conversationId);
                  }}
                >
                  <Trash2 className={compact ? "h-3 w-3" : "h-3.5 w-3.5"} />
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
