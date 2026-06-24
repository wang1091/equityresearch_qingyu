import logoImage from "@assets/logo_1756531121148.png";
import { useLocation } from "wouter";
import { ArrowDown } from "lucide-react";
import { useState, useRef, useEffect } from "react";
import type { Message } from "@/types";
import { LOCAL_API_BASE_URL } from "@/utils/constants";
import {
  type ActionLoadingKind,
  getModuleLoadingWords,
  getLoadingPhrase,
  getActionLoadingKindFromIntentInfo,
  isActionPhraseIntentInfo,
  getPreflightActionLoadingKind,
} from "@/utils/loadingPhrases";
import { useAgentStream } from "@/hooks/useAgentStream";
import {
  getInitialUILanguage,
  UI_LANGUAGE_STORAGE_KEY,
  UI_TEXTS,
  type UILanguage,
} from "@/utils/i18n";
import { useTimeoutManager, useQueryLanguage } from "@/hooks/useHelpers";
import { ChatHistoryPanel, useChatHistory } from "@/features/chatHistory";
import { ChatMessage, type ChatMessageActions } from "@/features/chat";
import { copyContent, getMessageCopyContent } from "@/features/chat/messageCopy";
import { getNavItems, getSuggestions } from "@/features/chat/homeConfig";
import { ChatComposer } from "@/features/chat/ChatComposer";
import { SiteSidebar, MobileDrawer, Topbar, MobileNavStrip } from "@/components/layout";
import { applyAgentEvent, type AgentStreamSession } from "@/features/chat/applyAgentEvent";
import { useAnswerFeedback } from "@/features/chat/useAnswerFeedback";
import { useNewsBrief } from "@/features/chat/useNewsBrief";
import { useTranslationOrchestrator } from "@/translation";
/**
 * Check if text contains Chinese characters
 */
const isChinese = (text: string): boolean => {
  return /[\u4e00-\u9fa5]/.test(text);
};

const Home = () => {
  const [, navigate] = useLocation();
  const [uiLanguage, setUiLanguage] = useState<UILanguage>(() => getInitialUILanguage());

  const [messages, setMessages] = useState<Message[]>(() => {
    const language = getInitialUILanguage();
    return [
      {
        id: 1,
        content: UI_TEXTS[language].welcomeMessage,
        sender: "agent",
        timestamp: new Date(),
      },
    ];
  });
  const [inputValue, setInputValue] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [loadingPhraseIndex, setLoadingPhraseIndex] = useState(0);
  const [preflightActionLoadingKind, setPreflightActionLoadingKind] =
    useState<ActionLoadingKind | null>(null);
  const [isGreetingCollapsed, setIsGreetingCollapsed] = useState(false);
  const [leftNavOpen, setLeftNavOpen] = useState(false);

  const conversationIdRef = useRef(`agent-${Date.now()}`);
  const abortControllerRef = useRef<AbortController | null>(null);
  const messagesRef = useRef<Message[]>(messages);
  const nextIdRef = useRef(2); // welcome message uses id=1
  const allocateIds = (count: number): number[] => {
    const start = nextIdRef.current;
    nextIdRef.current += count;
    return Array.from({ length: count }, (_, i) => start + i);
  };

  const { run: runAgentStream } = useAgentStream();
  const { timeoutsRef, clearAll: clearAllTimeouts } = useTimeoutManager();
  const { isChineseRef: isQueryInChineseRef, setIsChinese, reset: resetLanguage } = useQueryLanguage();
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messageContainerRef = useRef<HTMLDivElement>(null);
  const [showScrollButton, setShowScrollButton] = useState(false);

  const {
    isTranslating,
    requestTranslation,
    deferTranslation,
    flushPendingTranslation,
  } = useTranslationOrchestrator({ messages, setMessages, uiLanguage, isGenerating });

  const {
    handleFeedback,
    triggerGeminiFallback,
    consecutiveFailuresRef,
    consecutiveNegativeFeedbackRef,
  } = useAnswerFeedback({
    isGenerating,
    setIsGenerating,
    setIsLoading,
    setMessages,
    uiLanguage,
    messagesRef,
    flushPendingTranslation,
  });

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  useEffect(() => {
    if (!isLoading && !isGenerating) {
      setLoadingPhraseIndex(0);
      setPreflightActionLoadingKind(null);
      return;
    }

    const intervalId = window.setInterval(() => {
      setLoadingPhraseIndex((current) => current + 1);
    }, 1400);

    return () => window.clearInterval(intervalId);
  }, [isLoading, isGenerating, uiLanguage]);

  useEffect(() => {
    window.localStorage.setItem(UI_LANGUAGE_STORAGE_KEY, uiLanguage);
    document.documentElement.lang = uiLanguage === "zh" ? "zh-CN" : "en";
  }, [uiLanguage]);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    setShowScrollButton(false);
  };

  // 监听用户滚动
  useEffect(() => {
    const container = messageContainerRef.current;
    if (!container) return;

    const handleScroll = () => {
      const { scrollTop, scrollHeight, clientHeight } = container;
      const hasScrollbar = scrollHeight > clientHeight;
      const isAtBottom = scrollHeight - scrollTop - clientHeight < 100;
      // 有滚动条且不在底部时显示箭头
      setShowScrollButton(hasScrollbar && !isAtBottom);
    };

    // 初始检查
    handleScroll();

    container.addEventListener('scroll', handleScroll);
    // 监听内容变化（消息增加时重新检查）
    const resizeObserver = new ResizeObserver(handleScroll);
    resizeObserver.observe(container);

    return () => {
      container.removeEventListener('scroll', handleScroll);
      resizeObserver.disconnect();
    };
  }, [messages]);

  const getWelcomeMessage = (language: UILanguage): Message => ({
    id: 1,
    content: UI_TEXTS[language].welcomeMessage,
    sender: "agent",
    timestamp: new Date(),
  });

  const withWelcomeMessage = (restoredMessages: Message[]): Message[] => [
    getWelcomeMessage(uiLanguage),
    ...restoredMessages.map((message, index) => ({
      ...message,
      id: index + 2,
    })),
  ];

  const toggleUILanguage = () => {
    const previousLang = uiLanguage;
    const newLang: UILanguage = uiLanguage === "zh" ? "en" : "zh";
    console.log("[i18n] toggle clicked", { previousLang, newLang, isGenerating, msgCount: messagesRef.current.length });
    setUiLanguage(newLang);

    setMessages((prev) => {
      if (prev.length === 1 && prev[0].sender === "agent") {
        return [{ ...prev[0], content: UI_TEXTS[newLang].welcomeMessage }];
      }
      return prev;
    });

    if (isGenerating) {
      console.log("[i18n] toggle deferred (isGenerating=true)");
      deferTranslation(newLang);
      return;
    }

    requestTranslation(newLang, previousLang);
  };

  const handleStartOver = () => {
    clearAllTimeouts();
    resetLanguage();
    const nextConversationId = `agent-${Date.now()}`;
    conversationIdRef.current = nextConversationId;
    setActiveConversationId(nextConversationId);
    setIsLoading(false);
    setIsGenerating(false);
    setInputValue("");
    setIsGreetingCollapsed(false);
    nextIdRef.current = 2;
    setMessages([getWelcomeMessage(uiLanguage)]);
  };

  const {
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
  } = useChatHistory({
    uiLanguage,
    isGenerating,
    initialConversationId: conversationIdRef.current,
    onConversationRestored: (conversationId, restoredMessages) => {
      setMessages(withWelcomeMessage(restoredMessages));
      nextIdRef.current = restoredMessages.length + 2;
      setInputValue("");
      setIsGreetingCollapsed(true);
      setLeftNavOpen(false);
      setIsLoading(false);
      setIsGenerating(false);
      conversationIdRef.current = conversationId;
      setActiveConversationId(conversationId);
    },
    onConversationDeleted: (_conversationId, wasActive) => {
      if (wasActive) {
        handleStartOver();
      }
    },
  });

  const { handleGenerateNewsBrief } = useNewsBrief({
    isGenerating,
    uiLanguage,
    allocateIds,
    setMessages,
    setIsLoading,
    setIsGenerating,
    abortControllerRef,
    conversationIdRef,
    messagesRef,
    persistConversationSnapshot,
    flushPendingTranslation,
  });

  const createAgentMessage = async (
    content: string,
    modules?: string[],
  ): Promise<Message> => {
    const contentLanguageKey = uiLanguage === "zh" ? "contentZh" : "contentEn";
    return {
      id: Date.now(),
      content: content,
      sender: "agent",
      timestamp: new Date(),
      modules,
      displayLanguage: uiLanguage,
      [contentLanguageKey]: content,
    };
  };

  const handleRefine = (originalQuery: string) => {
    if (!originalQuery) return;
    const prefix = uiLanguage === "zh" ? "[请重新分析] " : "[Refine] ";
    setInputValue(prefix + originalQuery);
  };

  const handleSendMessage = async () => {
    if (!inputValue.trim()) return;

    if (isGenerating) {
      console.warn("⚠️ 已有回答正在生成中，请等待或点击停止按钮");
      return;
    }

    const originalInput = inputValue.trim();
    const currentConversationId = conversationIdRef.current;
    setIsChinese(isChinese(originalInput));
    setPreflightActionLoadingKind(getPreflightActionLoadingKind(originalInput, uiLanguage));

    // Reset failure/feedback counters on new query (unless it's a refine)
    if (!originalInput.startsWith("[Refine]") && !originalInput.startsWith("[请重新分析]")) {
      consecutiveFailuresRef.current = 0;
      consecutiveNegativeFeedbackRef.current = 0;
    }

    setActiveConversationId(currentConversationId);
    setIsGreetingCollapsed(true);

    const [userMessageId, intentMessageId, streamingMessageId] = allocateIds(3);
    const userMessage: Message = {
      id: userMessageId,
      content: originalInput,
      sender: "user",
      timestamp: new Date(),
    };

    const nextMessages = [...messagesRef.current, userMessage];

    setMessages(nextMessages);
    setInputValue("");
    setIsLoading(true);
    setIsGenerating(true);
    upsertHistoryItemLocally(currentConversationId, originalInput);
    void persistConversationSnapshot(currentConversationId, nextMessages);

    const controller = new AbortController();
    abortControllerRef.current = controller;
    let pendingAgentMessageId: number | null = null;

    try {
      // Intent classification happens in the backend; the stream emits a
      // one-shot { type: "classification" } event that populates intentInfo
      // (News Brief CTA, ticker). The gap animation is driven by the keyword
      // preflightActionLoadingKind set above. useAgentStream owns the transport
      // + SSE parsing; applyAgentEvent applies each frame to the message list.
      // Per-send running state lives in `session`.
      console.log("🤖 调用流式 Agent API（意图分类在后端进行）...");
      const session: AgentStreamSession = {
        accumulatedContent: "",
        messageAdded: false,
        requiredData: [],
      };
      const eventCtx = {
        uiLanguage,
        setMessages,
        setIsLoading,
        messagesRef,
        consecutiveFailuresRef,
        triggerGeminiFallback,
      };
      await runAgentStream(
        {
          conversationId: currentConversationId,
          message: originalInput,
          language: uiLanguage,
        },
        (event) => applyAgentEvent(event, session, { intentMessageId, streamingMessageId }, eventCtx),
        controller.signal,
      );
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        console.log("⚠️ 用户已停止生成");
        const stopMsg = await createAgentMessage(
          isQueryInChineseRef.current
            ? `<em>⏹️ 已停止生成</em>`
            : `<em>⏹️ Generation stopped</em>`,
        );
        setMessages((prev) => [...prev, stopMsg]);
        return;
      }

      console.error("Error calling agent API:", error);
      if (pendingAgentMessageId !== null) {
        setMessages((prev) => prev.filter((msg) => msg.id !== pendingAgentMessageId));
      }

      let errorContent: string;
      if (error instanceof Error && error.message.includes("响应体为空")) {
        errorContent = uiLanguage === "zh"
          ? `<strong>❌ 服务器错误</strong><br>服务器未正常响应。请确认后端服务是否正在运行。<br><br><em>提示：在终端运行 <code>npm run dev</code></em>`
          : `<strong>❌ Server Error</strong><br>Server is not responding properly. Please check if the backend is running.<br><br><em>Hint: Run <code>npm run dev</code> in terminal</em>`;
      } else {
        errorContent = uiLanguage === "zh"
          ? `<strong>❌ 处理失败</strong><br>${error instanceof Error ? error.message : "未知错误"}<br><br><em>${UI_TEXTS.zh.errorMoreSpecific}</em>`
          : `<strong>❌ Processing Failed</strong><br>${error instanceof Error ? error.message : "Unknown error"}<br><br><em>${UI_TEXTS.en.errorMoreSpecific}</em>`;
      }

      const errorMsg = await createAgentMessage(errorContent);
      setMessages((prev) => [...prev, errorMsg]);
    } finally {
      setIsLoading(false);
      setIsGenerating(false);
      abortControllerRef.current = null;
      await new Promise((resolve) => setTimeout(resolve, 0));
      await flushPendingTranslation(uiLanguage);
      await persistConversationSnapshot(currentConversationId, messagesRef.current);
    }
  };

  const handleStop = () => {
    if (abortControllerRef.current) {
      console.log("🛑 停止生成回答");
      abortControllerRef.current.abort();
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      handleSendMessage();
    }
  };

  const navItems = getNavItems(uiLanguage);
  const suggestions = getSuggestions(uiLanguage);

  const isHome = messages.length === 1;
  const getActionLoadingPhraseForKind = (kind: ActionLoadingKind) =>
    getLoadingPhrase(getModuleLoadingWords(kind), uiLanguage, loadingPhraseIndex);
  const getActionLoadingPhrase = (intentInfo?: Message["intentInfo"]) =>
    getActionLoadingPhraseForKind(getActionLoadingKindFromIntentInfo(intentInfo) || "general");
  const hasPendingActionPhraseMessage = messages.some(
    (message) =>
      message.sender === "agent" &&
      !message.content &&
      !message.newsData &&
      !message.briefData &&
      !message.cardData &&
      isActionPhraseIntentInfo(message.intentInfo),
  );
  const shouldShowPreflightActionPhrase =
    isLoading && !hasPendingActionPhraseMessage && Boolean(preflightActionLoadingKind);

  // Callback bundle handed to every <ChatMessage>. The 50ms send delay on
  // follow-ups lets setInputValue commit before handleSendMessage reads it.
  const chatActions: ChatMessageActions = {
    onFeedback: handleFeedback,
    onCopy: copyContent,
    getMessageCopyContent: (message) => getMessageCopyContent(message, uiLanguage),
    onRefine: handleRefine,
    onGenerateNewsBrief: (message) => handleGenerateNewsBrief(message.intentInfo, message),
    onFollowUpPick: (text) => setInputValue(text),
    onFollowUpSend: (text) => {
      setInputValue(text);
      setTimeout(() => handleSendMessage(), 50);
    },
  };

  const onNavigate = (url: string) =>
    url.startsWith("/") ? navigate(url) : window.open(url, "_blank");

  const historyPanel = (closeOnSelect: boolean) => (
    <ChatHistoryPanel
      uiLanguage={uiLanguage}
      chatHistoryItems={chatHistoryItems}
      isHistoryLoading={isHistoryLoading}
      historyLoadFailed={historyLoadFailed}
      activeConversationId={activeConversationId}
      onSelectHistory={(id) => { void handleSelectHistory(id); if (closeOnSelect) setLeftNavOpen(false); }}
      onDeleteHistory={(id) => { void handleDeleteHistory(id); }}
      formatHistoryTime={formatHistoryTime}
      compact
    />
  );

  return (
    <div className="flex h-[100dvh] overflow-hidden bg-[#f7f7f8]">
      <SiteSidebar navItems={navItems} onNavigate={onNavigate}>
        {historyPanel(false)}
      </SiteSidebar>

      <MobileDrawer open={leftNavOpen} onClose={() => setLeftNavOpen(false)} navItems={navItems} onNavigate={onNavigate}>
        {historyPanel(true)}
      </MobileDrawer>

      <div className="flex-1 flex flex-col min-w-0 h-[100dvh] overflow-hidden">
        <Topbar
          isHome={isHome}
          uiLanguage={uiLanguage}
          isTranslating={isTranslating}
          onOpenNav={() => setLeftNavOpen(true)}
          onStartOver={handleStartOver}
          onToggleLanguage={toggleUILanguage}
        />

        <MobileNavStrip navItems={navItems} onNavigate={onNavigate} />

        {/* ── Home: centered hero ── */}
        {isHome && (
          <div className="flex-1 flex flex-col items-center justify-center px-3 sm:px-6 pb-2 sm:pb-8 overflow-y-auto">
            <div className="flex items-center gap-2 mb-2 sm:mb-4">
              <img src={logoImage} alt="Checkit" className="h-6 w-6 sm:h-8 sm:w-8 rounded-lg object-contain" />
              <h1 className="text-base sm:text-xl font-semibold text-gray-900 tracking-tight">
                {UI_TEXTS[uiLanguage].appTitle}
              </h1>
            </div>

            <div className="w-full max-w-2xl">
              <ChatComposer
                variant="hero"
                value={inputValue}
                onChange={setInputValue}
                onKeyPress={handleKeyPress}
                onSend={handleSendMessage}
                onStop={handleStop}
                isGenerating={isGenerating}
                isLoading={isLoading}
                placeholder={UI_TEXTS[uiLanguage].inputPlaceholder}
              />

              {/* Suggestion chips — 2-col grid on mobile so all fit, wrap on desktop */}
              <div className="grid grid-cols-2 sm:flex sm:flex-wrap gap-1 sm:gap-1.5 mt-2 sm:mt-3 sm:justify-center">
                {suggestions.map((s) => (
                  <button
                    key={s}
                    onClick={() => { setInputValue(s); }}
                    className="px-2 py-1 rounded-lg sm:rounded-full text-xs bg-white border border-gray-200 text-gray-600 hover:border-gray-400 hover:text-gray-900 transition-colors shadow-sm touch-manipulation text-left sm:text-center truncate"
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* ── Chat thread ── */}
        {!isHome && (
          <div className="flex-1 flex flex-col min-h-0 relative">
            {/* Scrollable messages */}
            <div
              ref={messageContainerRef}
              className="flex-1 overflow-y-auto overscroll-contain"
              style={{ paddingBottom: "72px" }}
            >
              <div className="max-w-2xl mx-auto px-3 sm:px-4 py-3 sm:py-4 space-y-4 sm:space-y-5">
                {messages
                  .filter((msg) => msg.id !== 1)
                  .map((message) => (
                    <div key={message.id} data-message-id={message.id}>
                      <ChatMessage
                        message={message}
                        messages={messages}
                        uiLanguage={uiLanguage}
                        isGenerating={isGenerating}
                        getActionLoadingPhrase={getActionLoadingPhrase}
                        actions={chatActions}
                      />
                    </div>
                  ))}

                {/* Typing indicator */}
                {shouldShowPreflightActionPhrase ? (
                  <div className="flex items-center gap-2 text-xs text-gray-400">
                    <span className="relative flex h-3.5 w-3.5">
                      <span className="absolute inline-flex h-full w-full rounded-full bg-indigo-400 opacity-30 animate-ping" />
                      <span className="relative inline-flex h-3.5 w-3.5 rounded-full bg-indigo-500 animate-pulse" />
                    </span>
                    <span className="font-medium text-indigo-500">
                      {getActionLoadingPhraseForKind(preflightActionLoadingKind!)}
                      <span className="inline-flex w-5 justify-between ml-1 align-middle">
                        <span className="animate-bounce [animation-delay:-0.3s]">.</span>
                        <span className="animate-bounce [animation-delay:-0.15s]">.</span>
                        <span className="animate-bounce">.</span>
                      </span>
                    </span>
                  </div>
                ) : isLoading && !hasPendingActionPhraseMessage && (
                  <div className="flex items-center gap-2 text-xs text-gray-400">
                    <div className="loading-spinner w-3.5 h-3.5" />
                    <span>{UI_TEXTS[uiLanguage].analyzingData}</span>
                  </div>
                )}

                {isTranslating && !isLoading && (
                  <div className="flex items-center gap-2 text-xs text-gray-400">
                    <div className="loading-spinner w-3.5 h-3.5" />
                    <span>{UI_TEXTS[uiLanguage].translating}</span>
                  </div>
                )}

                <div ref={messagesEndRef} />
              </div>
            </div>

            {/* Scroll-to-bottom */}
            {showScrollButton && (
              <div className="absolute bottom-20 left-1/2 -translate-x-1/2 z-10">
                <button onClick={scrollToBottom} className="bg-white border border-gray-200 rounded-full p-2 shadow-md hover:shadow-lg transition-all" data-testid="scroll-to-bottom-button">
                  <ArrowDown className="w-4 h-4 text-gray-500" />
                </button>
              </div>
            )}

            {/* Sticky input bar — safe-area aware */}
            <div className="absolute bottom-0 left-0 right-0 bg-[#f7f7f8] px-3 sm:px-4 pt-1.5 pb-2"
              style={{ paddingBottom: "calc(0.5rem + env(safe-area-inset-bottom, 0px))" }}
            >
              <div className="max-w-2xl mx-auto">
                <ChatComposer
                  variant="bottom"
                  value={inputValue}
                  onChange={setInputValue}
                  onKeyPress={handleKeyPress}
                  onSend={handleSendMessage}
                  onStop={handleStop}
                  isGenerating={isGenerating}
                  isLoading={isLoading}
                  placeholder={UI_TEXTS[uiLanguage].inputPlaceholder}
                />
              </div>
            </div>
          </div>
        )}

      </div>
    </div>
  );
};

export default Home;
