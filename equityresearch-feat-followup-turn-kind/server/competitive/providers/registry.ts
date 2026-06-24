// Central provider registry. Adding a new provider:
//   1. Implement Provider<I, R> in providers/<layer>/<name>/index.ts
//   2. Register the instance below
//   3. Optionally add to runResearchPipeline / runAnalysisPipeline's chain
// service.ts / handler.ts require no changes.

import { perplexityProvider } from "./research/perplexity";
import { deepseekProvider } from "./analysis/deepseek";
import { withAnalysisRetry } from "./retry";
import type { AnalysisProvider, ResearchProvider } from "./types";

// Perplexity is intentionally NOT wrapped in retry: its 45s timeout means
// a retry doubles total latency (≈ 2× the timeout cap) — bad chat UX.
// When/if we switch to sonar-pro (faster) we can enable retry.
export const researchProviders: Record<string, ResearchProvider> = {
  perplexity: perplexityProvider,
};

// DeepSeek timeout 20s, so one retry caps worst-case at ~41s.
// Retries fire on UPSTREAM_LLM_FAILED + TIMEOUT (transient); NOT on
// INTERNAL / INVALID_INPUT (request or local bugs).
export const analysisProviders: Record<string, AnalysisProvider> = {
  deepseek: withAnalysisRetry(deepseekProvider, { maxRetries: 1, delayMs: 500 }),
};

export function getResearchProvider(id: string): ResearchProvider | undefined {
  return researchProviders[id];
}

export function getAnalysisProvider(id: string): AnalysisProvider | undefined {
  return analysisProviders[id];
}
