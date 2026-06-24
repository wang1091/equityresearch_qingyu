import { logger as moduleLogger } from "../../../logger";
import { CompetitiveError } from "../../../errors";
import {
  AnalysisOutputSchema,
  summarizeZodIssues,
  validateForceScoreDistribution,
} from "../../../schemas";
import { elapsedMs, nowNs } from "../../../timing";
import { cleanJsonResponse } from "../../../../utils";
import type {
  AnalysisInput,
  AnalysisOutcome,
  AnalysisProvider,
} from "../../types";
import { SYSTEM_PROMPT, buildUserPrompt } from "./prompts";

const TIMEOUT_MS = 20000;
const MODEL = "deepseek-chat";
// 2000 (was 1200): the five analysis strings + overall_assessment can run
// long, especially for lang="zh" (Chinese tokens are heavier). A tight cap
// triggers finish_reason="length", which throws and burns a full retry.
const MAX_TOKENS = 2000;
const TEMPERATURE = 0.3;

const logger = moduleLogger.child({ step: "analysis", provider: "deepseek" });

const getKey = () =>
  process.env.DEEPSEEK_API_KEY || process.env.DEEPSEEK_KEY;

async function perform(input: AnalysisInput): Promise<AnalysisOutcome> {
  const start = nowNs();
  logger.info(`\n⏱️  DeepSeek 分析生成 - 开始...`);

  const apiKey = getKey();
  if (!apiKey) {
    throw new CompetitiveError("INTERNAL", "DeepSeek API key not configured");
  }

  const res = await fetch("https://api.deepseek.com/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    signal: AbortSignal.timeout(TIMEOUT_MS),
    body: JSON.stringify({
      model: MODEL,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        {
          role: "user",
          content: buildUserPrompt({
            companyName: input.companyName,
            researchContext: input.researchContext,
            additionalContext: input.additionalContext,
            lang: input.lang,
          }),
        },
      ],
      temperature: TEMPERATURE,
      max_tokens: MAX_TOKENS,
      // JSON mode: DeepSeek guarantees the response body is parseable JSON
      // (no markdown fences, no prose prefix). This only guarantees *valid
      // JSON*, NOT schema conformance — Zod below still does the real
      // structural validation. Requires the word "json" in the prompt
      // (satisfied by SYSTEM_PROMPT). Known caveat: JSON mode can rarely
      // return empty/whitespace content, which the empty-content check and
      // retry already cover.
      response_format: { type: "json_object" },
    }),
  });

  if (!res.ok) {
    const detail = await res.text();
    throw new CompetitiveError(
      "UPSTREAM_LLM_FAILED",
      `DeepSeek error ${res.status}: ${detail}`,
    );
  }

  const data = await res.json();

  // Explicit shape check before optional-chain into possibly-undefined paths.
  // If DeepSeek changes their response structure, we want a meaningful error
  // (not "Unexpected end of JSON input" downstream).
  if (!data || !Array.isArray(data.choices) || data.choices.length === 0) {
    throw new CompetitiveError(
      "UPSTREAM_LLM_FAILED",
      `DeepSeek response missing choices array`,
    );
  }
  const choice = data.choices[0];
  if (choice.finish_reason === "length") {
    throw new CompetitiveError(
      "UPSTREAM_LLM_FAILED",
      `DeepSeek truncated output by max_tokens (finish_reason=length); raise MAX_TOKENS`,
    );
  }
  const rawContent: string = choice.message?.content || "";
  if (!rawContent) {
    throw new CompetitiveError("UPSTREAM_LLM_FAILED", "DeepSeek returned empty content");
  }

  // Use the shared markdown-fence stripper from utils — same regex/fallback
  // logic the rest of the codebase already relies on.
  const jsonStr = cleanJsonResponse(rawContent);

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonStr);
  } catch (e) {
    throw new CompetitiveError(
      "UPSTREAM_LLM_FAILED",
      `Failed to parse DeepSeek JSON: ${e instanceof Error ? e.message : "Unknown"}`,
    );
  }

  const validation = AnalysisOutputSchema.safeParse(parsed);
  if (!validation.success) {
    throw new CompetitiveError(
      "UPSTREAM_LLM_FAILED",
      `DeepSeek output schema validation failed: ${summarizeZodIssues(validation.error.issues)}`,
    );
  }

  const validated = validation.data;

  // Business-quality gate (currently a no-op placeholder). Runs after Zod so
  // it can assume well-formed forces. A non-null return means the score
  // distribution is degenerate (e.g. undifferentiated) and surfaces as a
  // retryable UPSTREAM_LLM_FAILED via the analysis retry wrapper.
  const distributionIssue = validateForceScoreDistribution(validated.forces);
  if (distributionIssue) {
    throw new CompetitiveError("UPSTREAM_LLM_FAILED", distributionIssue);
  }

  const durationMs = elapsedMs(start);
  logger.info(`✅ DeepSeek 完成 (${durationMs.toFixed(1)}ms)`);
  return {
    company: validated.company || input.companyName,
    industry: validated.industry,
    forces: validated.forces,
    overall_assessment: validated.overall_assessment,
    durationMs,
  };
}

export const deepseekProvider: AnalysisProvider = {
  id: "deepseek",
  model: MODEL,
  perform,
};
