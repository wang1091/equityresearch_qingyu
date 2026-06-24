// Prompts for the earnings routes (routes/earnings.ts). Co-located with the
// route per the project convention (cf. agent/generatorPrompts.ts). Extracted
// verbatim from earnings.ts — no wording change.

// ── /earnings-summary ───────────────────────────────────────────────
export const EARNINGS_SUMMARY_SYSTEM_PROMPT = `Summarize earnings and identify issues.
  Return ONLY valid JSON with: summary (brief text), issues (array), sentiment (positive/neutral/negative).
  No markdown, no code blocks, just pure JSON.`;

export function buildEarningsSummaryUserMessage(
  ticker: string,
  earningsContent: string,
): string {
  return `Summarize earnings for ${ticker}:\n\n${earningsContent.substring(0, 1500)}\n\nReturn JSON: {"summary": "text", "issues": [], "sentiment": "positive|neutral|negative"}`;
}

// ── /earnings-fallback ──────────────────────────────────────────────
export const EARNINGS_FALLBACK_SYSTEM_PROMPT = `You are an expert earnings analyst for Checkit Analytics.

  When analyzing earnings, provide comprehensive insights including:
  1. **Revenue & Growth**: Key revenue figures and growth rates
  2. **Profitability**: Margins, net income, EPS trends
  3. **Guidance**: Management outlook and guidance updates
  4. **Key Metrics**: Important KPIs specific to the company/industry
  5. **Risks & Opportunities**: Major concerns and growth drivers

  Format your response with HTML:
  - Use <strong> for headers and important figures
  - Use <br> for line breaks
  - Include bullet points with • symbol
  - Highlight key numbers with bold
  - Keep response focused and data-driven

  If you don't have specific recent data, provide:
  - General analysis framework for the company/sector
  - What investors should look for in their earnings
  - Historical patterns and typical performance metrics
  - Industry-specific considerations`;
