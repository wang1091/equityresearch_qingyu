// DeepSeek key resolution + the canonical chat-response shape. The actual
// transport (POST /chat/completions) now lives in the shared LLM layer
// (server/llm/chat.ts deepSeekChatProvider) — every DeepSeek call goes through
// callChatWithFailover, so there is no separate bare-fetch client here anymore.
// This module is kept small because chat.ts still depends on both exports:
// `getDeepSeekApiKey` (resolveChatChain) and `DeepSeekChatResponse` (aliased as
// ChatResponse). `_shared.ts` re-exports the key getter for the route handlers.

export const getDeepSeekApiKey = (): string | undefined =>
  process.env.DEEPSEEK_API_KEY || process.env.DEEPSEEK_KEY;

export interface DeepSeekChatResponse {
  choices?: Array<{
    message?: { content?: string };
    finish_reason?: string;
  }>;
  /** Source URLs, populated by search providers (Perplexity). Absent for
   *  DeepSeek/Gemini. `postOpenAiCompatible` returns the whole parsed body, so
   *  a provider's top-level `citations` flows through unchanged. */
  citations?: string[];
  /** Token accounting from the provider (the whole body flows through, so this is
   *  present whenever the upstream returns it). DeepSeek adds prompt-cache fields:
   *  prompt_cache_hit_tokens / _miss_tokens let us monitor real cache effectiveness
   *  (see docs/CORPUS_SCAN_USAGE.md notes on the static-prefix cache). */
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
    prompt_cache_hit_tokens?: number;
    prompt_cache_miss_tokens?: number;
  };
}
