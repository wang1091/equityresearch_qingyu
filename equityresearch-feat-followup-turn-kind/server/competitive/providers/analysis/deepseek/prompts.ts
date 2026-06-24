// DeepSeek-specific prompts. Lives next to the provider so swapping for
// another analysis model (GPT-4o, Claude, etc.) doesn't fight over file
// naming or globals. Cross-provider concepts (Porter's Five Forces score
// anchoring) are documented in COMPETITIVE_BUG_FIX_REPORT.md ("Prompt
// JSON Template Score Anchoring") and re-asserted in this prompt body.

import { sanitizeForPrompt } from "../../../prompts/sanitize";

export const SYSTEM_PROMPT =
  "You are an expert business analyst. Respond ONLY with valid JSON, no markdown.";

export interface AnalysisPromptInput {
  companyName: string;
  researchContext: string;
  additionalContext?: string;
  // "zh" instructs the model to write all natural-language fields
  // (industry, forces.analysis, overall_assessment) in Simplified Chinese.
  // JSON keys and the company string stay as-is. "both" is treated as
  // "en" for now — see AnalysisInput docstring.
  lang?: "en" | "zh" | "both";
}

// CRITICAL: do NOT re-introduce a JSON template with literal example scores
// (neither uniform "5"s nor varied ones like 8/6/7/5/6). Any concrete score
// in the template gets copied by the model and collapses real scoring. This
// prompt deliberately describes the JSON *contract* in words instead. See
// COMPETITIVE_BUG_FIX_REPORT.md ("Prompt JSON Template Score Anchoring").
export function buildUserPrompt(input: AnalysisPromptInput): string {
  const company = sanitizeForPrompt(input.companyName);
  const research = (input.researchContext || "").slice(0, 20000);
  const ctx = sanitizeForPrompt(input.additionalContext, 2000);
  const wantChinese = input.lang === "zh";

  const languageInstruction = wantChinese
    ? `LANGUAGE: Write the values of "industry", every "analysis" string, and "overall_assessment" in Simplified Chinese (简体中文). JSON keys ("industry", "forces", "competitive_rivalry", "score", "analysis", "overall_assessment", "company") MUST stay in English. Scores stay as integers.`
    : `LANGUAGE: Write all string values in English.`;

  return `Analyze ${company} using Porter's Five Forces.

${languageInstruction}

Research Context:
${research || "No real-time research available."}

${ctx ? `Additional context: ${ctx}` : ""}

SCORING:
- For EACH of the 5 forces, assign an INTEGER score from 1 to 10 based on YOUR independent
  assessment of ${company} specifically.
  (1 = very low intensity / weak threat / minimal pressure; 10 = very high intensity /
  overwhelming threat / dominant pressure on the company.)
- Before writing each score, ask: "Is this force notably strong, moderate, or weak for
  ${company}'s specific situation right now?" Then pick the integer that fits. Different
  forces of the same company should generally produce different scores; do not default to
  a single middle value across all five.

Return one JSON object with exactly these keys: company, industry, forces, overall_assessment.

- company: "${company}"
- industry: the industry identified from the research
- forces: an object with exactly these five keys, in this order:
    competitive_rivalry, threat_of_new_entrants, threat_of_substitutes,
    supplier_power, buyer_power
  Each force is an object with:
    score:    integer 1-10 (your independent assessment, per the rules above)
    analysis: a concise, evidence-based explanation grounded in the research context
- overall_assessment: a concise summary of the company's competitive position

Respond with the JSON object only — no markdown, no prose outside the JSON.`;
}
