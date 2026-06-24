// Perplexity-specific prompts. Lives next to the provider implementation
// because the wording is tuned for Perplexity's behavior (search-aware
// reasoning model). When/if we add Tavily, it gets its own prompts.ts
// rather than fighting for shared naming.

import { sanitizeForPrompt } from "../../../prompts/sanitize";

export const SYSTEM_PROMPT =
  "You are a business research assistant. Provide concise, factual competitive intelligence.";

export interface ResearchPromptInput {
  companyName: string;
  ticker?: string;
  additionalContext?: string;
}

export function buildUserPrompt(input: ResearchPromptInput): string {
  const company = sanitizeForPrompt(input.companyName);
  const ticker = sanitizeForPrompt(input.ticker, 20);
  const ctx = sanitizeForPrompt(input.additionalContext, 2000);
  return (
    `Research the company ${company}` +
    (ticker ? ` (ticker: ${ticker})` : "") +
    `. Identify its industry, key competitors, market position, and recent strategic moves.` +
    (ctx ? ` Context: ${ctx}` : "")
  );
}
