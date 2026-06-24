import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import type { FollowUp, Message } from "@/types";
import { MODULE_META, LOCAL_API_BASE_URL } from "@/utils/constants";
import { type UILanguage } from "@/utils/i18n";
import type { AgentStreamEvent } from "@/hooks/useAgentStream";

/**
 * Per-send mutable state shared across SSE event reducers. Replaces the `let`s
 * that used to live in the old handleSendMessage loop; the component threads one
 * of these through every applyAgentEvent call so the `content` accumulator and
 * the `done` finalizer see the same running state.
 */
export interface AgentStreamSession {
  intentInfo?: Message["intentInfo"];
  accumulatedContent: string;
  messageAdded: boolean;
  requiredData: string[];
  unifiedSidecar?: Message["unifiedData"];
  historyProjection?: string;
}

/** Component-owned dependencies the reducer needs to mutate React state. */
export interface AgentEventContext {
  uiLanguage: UILanguage;
  setMessages: Dispatch<SetStateAction<Message[]>>;
  setIsLoading: (value: boolean) => void;
  messagesRef: MutableRefObject<Message[]>;
  consecutiveFailuresRef: MutableRefObject<number>;
  triggerGeminiFallback: (query: string) => void;
}

/**
 * Apply one parsed SSE frame to the message list. Extracted verbatim from
 * home.tsx; the transport lives in useAgentStream and calls this per frame.
 * Throwing on an `error` frame is intentional — useAgentStream's per-line catch
 * swallows it (preserving the original inline-loop behavior).
 */
export function applyAgentEvent(
  event: AgentStreamEvent,
  session: AgentStreamSession,
  ids: { intentMessageId: number; streamingMessageId: number },
  ctx: AgentEventContext,
): void {
  const { intentMessageId, streamingMessageId } = ids;
  const { uiLanguage, setMessages, setIsLoading, messagesRef, consecutiveFailuresRef, triggerGeminiFallback } = ctx;

  switch (event.type) {
    case "classification": {
      // Backend's final routing tuple — drives News Brief CTA + ticker.
      session.intentInfo = {
        intents: event.required_data || event.intents || [],
        tickers: event.tickers || [],
        reasoning: event.reasoning || "",
        confidence: event.confidence || 0,
      };
      // Backfill if a message already rendered (event ordering safety).
      if (session.messageAdded) {
        setMessages((prev) =>
          prev.map((msg) =>
            msg.id === streamingMessageId ? { ...msg, intentInfo: session.intentInfo } : msg,
          ),
        );
      }
      break;
    }

    case "content": {
      session.accumulatedContent += event.chunk;

      if (!session.messageAdded && session.accumulatedContent.trim()) {
        const streamingMessage: Message = {
          id: streamingMessageId,
          content: session.accumulatedContent,
          sender: "agent",
          timestamp: new Date(),
          intentInfo: session.intentInfo,
          displayLanguage: uiLanguage,
          [uiLanguage === "zh" ? "contentZh" : "contentEn"]: session.accumulatedContent,
        };
        // Replace intentMessage with streamingMessage to avoid duplicate intent chips
        setMessages((prev) => [
          ...prev.filter((m) => m.id !== intentMessageId),
          streamingMessage,
        ]);
        session.messageAdded = true;
        setIsLoading(false);
      } else if (session.messageAdded) {
        setMessages((prev) =>
          prev.map((msg) =>
            msg.id === streamingMessageId
              ? {
                  ...msg,
                  content: session.accumulatedContent,
                  displayLanguage: uiLanguage,
                  [uiLanguage === "zh" ? "contentZh" : "contentEn"]: session.accumulatedContent,
                }
              : msg,
          ),
        );
      }
      break;
    }

    case "news_v2": {
      if (!event.payload) break;
      // Single-NEWS structured payload — render via NewsPreview.
      const newsMessage: Message = {
        id: streamingMessageId,
        content: "",
        sender: "agent",
        timestamp: new Date(),
        intentInfo: session.intentInfo,
        newsData: event.payload,
        displayLanguage: uiLanguage,
        [uiLanguage === "zh" ? "newsDataZh" : "newsDataEn"]: event.payload,
      };
      setMessages((prev) => [
        ...prev.filter((m) => m.id !== intentMessageId && m.id !== streamingMessageId),
        newsMessage,
      ]);
      session.messageAdded = true;
      setIsLoading(false);
      break;
    }

    // COMPETITIVE folded onto the generic `source_card` event (handled below);
    // the registry renders <CompetitiveResultCard> by source "COMPETITIVE".

    case "source_card": {
      if (!event.payload) break;
      // Generic structured card — stash {source, payload}; the renderer registry
      // (features/chat/renderers) picks the component by source.
      const sourceCardMessage: Message = {
        id: streamingMessageId,
        content: "",
        sender: "agent",
        timestamp: new Date(),
        intentInfo: session.intentInfo,
        cardData: { source: event.source, payload: event.payload },
        displayLanguage: uiLanguage,
      };
      setMessages((prev) => [
        ...prev.filter((m) => m.id !== intentMessageId && m.id !== streamingMessageId),
        sourceCardMessage,
      ]);
      session.messageAdded = true;
      setIsLoading(false);
      break;
    }

    // STOCK_PICKER folded onto the generic `source_card` event (handled above);
    // the registry renders <StockPickerCard> by source "STOCK_PICKER".

    case "unified_answer": {
      if (!event.payload) break;
      // Unified-answer sidecar (verdict + sources/cards). The markdown
      // body arrives separately via `content` events; here we just stash
      // the sidecar to attach to the message at `done`.
      const p = event.payload;
      session.unifiedSidecar = {
        ...(p.verdict ? { verdict: p.verdict } : {}),
        ...(p.citations ? { citations: p.citations } : {}),
        ...(p.source_cards ? { source_cards: p.source_cards } : {}),
        ...(p.notice ? { notice: p.notice } : {}),
      };
      break;
    }

    case "history_projection": {
      // Precomputed routing line for an HTML direct card — stash it now,
      // attach at `done` so it persists and survives a reload (live === reload).
      if (event.text) session.historyProjection = event.text;
      break;
    }

    case "tool_call": {
      const { dataSource, status, data: toolData, error, duration } = event;
      if (status === "start") {
        console.log(`🔧 [工具调用] ${dataSource} - 开始`);
      } else if (status === "success") {
        console.log(`✅ [工具调用] ${dataSource} - 成功 (${duration}ms)`);
        console.log("📥 响应数据:", toolData);
      } else if (status === "error") {
        console.error(`❌ [工具调用] ${dataSource} - 失败 (${duration}ms): ${error}`);
      }
      break;
    }

    case "done": {
      console.log("✅ Agent 完成，元数据:", event.metadata);
      session.requiredData = event.metadata?.requiredData || [];

      const moduleMapping: Record<string, string> = {
        NEWS: "news",
        VALUATION: "valuation",
        EARNINGS: "earnings",
        DATA: "data",
        KEY_METRICS: "data",
        PERFORMANCE: "data",
        FDA: "fda",
        RUMOR: "rumorcheck",
        RUMOR_CHECK: "rumorcheck",
        COMPETITIVE: "competitive",
        GENERAL: "",
      };

      const mappedModules = session.requiredData
        .map((source: string) => moduleMapping[source] || source.toLowerCase())
        .filter(
          (module: string) => module && MODULE_META[module as keyof typeof MODULE_META],
        );

      console.log("🔗 映射后的模块:", mappedModules);

      // Extract key_insights from structured JSON. Follow-ups are NOT
      // embedded in the answer anymore — they come solely from the
      // dedicated Follow-Up Engine (/api/follow-ups) fired below.
      let keyInsights: string[] | undefined;
      try {
        const parsed = JSON.parse(session.accumulatedContent);
        if (Array.isArray(parsed.key_insights)) keyInsights = parsed.key_insights;
      } catch { /* not JSON, that's fine */ }

      setMessages((prev) =>
        prev.map((msg) =>
          msg.id === streamingMessageId
            ? {
                ...msg,
                content: session.accumulatedContent,
                modules: mappedModules,
                keyInsights,
                ...(session.unifiedSidecar ? { unifiedData: session.unifiedSidecar } : {}),
                ...(session.historyProjection ? { classifierText: session.historyProjection } : {}),
                displayLanguage: uiLanguage,
                [uiLanguage === "zh" ? "contentZh" : "contentEn"]: session.accumulatedContent,
                ...(keyInsights
                  ? { [uiLanguage === "zh" ? "keyInsightsZh" : "keyInsightsEn"]: keyInsights }
                  : {}),
              }
            : msg,
        ),
      );

      // Fire Follow-Up Engine (non-blocking — updates message when ready)
      // for every answer with content. Both structured and SIMPLE paths
      // now rely on it as the single source of follow-ups.
      if (session.accumulatedContent && !session.accumulatedContent.includes("Analysis Unavailable")) {
        const lastUserMsg = [...messagesRef.current].reverse().find((m) => m.sender === "user");
        // Window (-8) + per-turn cap (300) match the server's follow-ups
        // history handling (routes/followupsPrompts.ts) so we don't ship
        // bytes it will only re-truncate/drop. See docs/LLM_HISTORY_CONTEXT_PLAN.md (B4).
        const recentHistory = messagesRef.current.slice(-8).map((m) => ({
          role: m.sender === "user" ? "user" : "assistant",
          content: String(m.content).substring(0, 300),
        }));
        fetch(`${LOCAL_API_BASE_URL}/api/follow-ups`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            user_question: lastUserMsg?.content || "",
            agent_answer: session.accumulatedContent.substring(0, 1500),
            ticker: session.intentInfo?.tickers?.[0] || "",
            available_data: session.requiredData,
            conversation_history: recentHistory,
            language: uiLanguage,
          }),
        })
          .then((r) => (r.ok ? r.json() : null))
          .then((result) => {
            if (!result?.follow_ups?.length) return;
            const fups: FollowUp[] = result.follow_ups;
            setMessages((prev) => prev.map((msg) =>
              msg.id === streamingMessageId
                ? { ...msg, structuredFollowups: fups }
                : msg
            ));
          })
          .catch(() => { /* silent — follow-ups are best-effort */ });
      }

      // Track consecutive "Analysis Unavailable" failures
      const isUnavailable = session.accumulatedContent.includes("Analysis Unavailable") || session.accumulatedContent.includes("Failed to generate");
      if (isUnavailable) {
        consecutiveFailuresRef.current += 1;
        if (consecutiveFailuresRef.current >= 2) {
          const lastUserMsg = [...messagesRef.current].reverse().find((m) => m.sender === "user");
          if (lastUserMsg) triggerGeminiFallback(lastUserMsg.content);
        }
      } else {
        consecutiveFailuresRef.current = 0;
      }
      break;
    }

    case "error": {
      throw new Error(event.error || "流式响应错误");
    }
  }
}
