// Shared helpers for the split route modules (routes.ts + routes/*.ts).
// Single source of truth for cross-domain env getters. Domain-specific getters
// (valuation/rumor/trending URLs) stay with their domain — only add things here
// that more than one route module legitimately needs.
//
// Getters are functions (not constants) so env changes are picked up at call time.
import { getDeepSeekApiKey } from "../llm/deepseek";

/** DeepSeek API key (primary LLM). Used by valuation, redflags, earnings, gemini-fallback.
 *  Re-exported from the shared DeepSeek client so key resolution lives in one place. */
export const getDeepSeekKey = getDeepSeekApiKey;

/** Perplexity API key (search/fallback LLM). Used by recommend, general-qa, earnings QA, rumor. */
export const getPerplexityKey = (): string | undefined => process.env.PERPLEXITY_API_KEY;
