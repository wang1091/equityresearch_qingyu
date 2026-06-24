/**
 * useAgentStream — transport + parsing layer for the agent chat stream.
 *
 * PURPOSE: this hook owns ONLY the mechanical side of talking to
 * `/api/agent/chat-stream`: issue the POST, read the ReadableStream, buffer
 * partial lines, parse each `data:` SSE frame into a typed `AgentStreamEvent`,
 * and hand it to the caller's `onEvent`. It deliberately knows nothing about
 * React state, the message list, follow-ups, or the loading animation — all of
 * that stays in the component reducer (home.tsx `handleAgentEvent`).
 *
 * Why split it out: the buffering logic (`buffer = lines.pop()` keeps a partial
 * trailing line until the next read) is the easiest part to get subtly wrong and
 * the only part worth unit-testing with a fake chunked stream. Isolating it from
 * the ~9 `setMessages` reducers makes both halves readable.
 *
 * Abort: the controller is NOT owned here — the component keeps `abortControllerRef`
 * (shared with the News-Brief flow + `handleStop`) and passes a `signal` in.
 *
 * Errors: a thrown `onEvent` (e.g. on a `{type:"error"}` frame) is swallowed by
 * the per-line `catch` and only logged — this preserves the pre-existing behavior
 * of the inline loop, where the `error` frame never reached the outer handler.
 * Genuine transport failures (`!ok`, no body, network, abort) still reject `run`.
 */
import { useCallback } from "react";
import type { NewsV2Data, UnifiedAnswerData } from "@/types";
import type { UILanguage } from "@/utils/i18n";
import { LOCAL_API_BASE_URL } from "@/utils/constants";

/** The typed SSE protocol emitted by `/api/agent/chat-stream`. */
export type AgentStreamEvent =
  | {
      type: "classification";
      required_data?: string[];
      intents?: string[];
      tickers?: string[];
      reasoning?: string;
      confidence?: number;
    }
  | { type: "content"; chunk: string }
  | { type: "news_v2"; payload: NewsV2Data }
  | { type: "source_card"; source: string; payload: unknown }
  | { type: "unified_answer"; payload: UnifiedAnswerData & { body?: string } }
  | { type: "history_projection"; text: string }
  | {
      type: "tool_call";
      dataSource?: string;
      status?: "start" | "success" | "error";
      data?: unknown;
      error?: string;
      duration?: number;
    }
  | { type: "done"; metadata?: { requiredData?: string[] } }
  | { type: "error"; error?: string };

export interface AgentStreamRequest {
  conversationId: string;
  message: string;
  language: UILanguage;
}

/**
 * Pure transport: POST the request and drive the SSE stream to completion,
 * invoking `onEvent` once per parsed frame. Resolves when the stream closes;
 * rejects on transport failure (caller's try/catch handles the AbortError +
 * error-card UI). `fetchImpl` is injectable purely so the buffering/parsing can
 * be unit-tested with a fake chunked stream — production always uses global fetch.
 */
export async function consumeAgentStream(
  request: AgentStreamRequest,
  onEvent: (event: AgentStreamEvent) => void,
  signal: AbortSignal,
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  const response = await fetchImpl(`${LOCAL_API_BASE_URL}/api/agent/chat-stream`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request),
    signal,
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error("API error response:", errorText);
    throw new Error(`API 调用失败: ${response.status} - ${response.statusText}`);
  }
  if (!response.body) {
    throw new Error("响应体为空");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      console.log("✅ 流式响应完成");
      break;
    }

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() || ""; // keep the partial trailing line for next read

    for (const line of lines) {
      if (!line.startsWith("data: ")) continue;
      try {
        const event = JSON.parse(line.slice(6)) as AgentStreamEvent;
        onEvent(event);
      } catch (parseError) {
        console.warn("解析 SSE 数据失败:", line, parseError);
      }
    }
  }
}

export function useAgentStream() {
  const run = useCallback(
    (
      request: AgentStreamRequest,
      onEvent: (event: AgentStreamEvent) => void,
      signal: AbortSignal,
    ): Promise<void> => consumeAgentStream(request, onEvent, signal),
    [],
  );

  return { run };
}
