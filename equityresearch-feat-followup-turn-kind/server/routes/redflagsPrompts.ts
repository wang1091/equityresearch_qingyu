// Prompts for red-flag analysis (routes/redflags.ts). Co-located with the route
// per the project convention (cf. agent/generatorPrompts.ts). Extracted verbatim
// from redflags.ts — no wording change.

export const REDFLAGS_SYSTEM_PROMPT = `Analyze news for red flags (risks, issues, problems).
  Return ONLY valid JSON with: redflag_count (0-5), severity (low/medium/high), summary.
  No markdown, no code blocks, just pure JSON.`;

export function buildRedflagsUserMessage(ticker: string, newsContent: string): string {
  return `Analyze news for ${ticker}:\n\n${newsContent.substring(0, 1500)}\n\nReturn JSON: {"redflag_count": number, "severity": "low|medium|high", "summary": "text"}`;
}
