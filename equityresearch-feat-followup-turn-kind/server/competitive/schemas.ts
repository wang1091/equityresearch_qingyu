// Zod schemas for boundary validation. Pattern borrowed from
// SmartNews/server/newsSearch/perplexity/queryParserSchema.ts.
//
// Schemas serve three purposes:
//   1. Validate inbound requests (handler.ts)
//   2. Validate outbound LLM JSON output (analysis.ts)
//   3. Self-documenting runtime contract — `z.infer<typeof X>` gives
//      type-safe data downstream without manual `as any` / `?.` chains.
//
// Keep this file in sync with COMPETITIVE_API_CONTRACT.md §3 / §4.

import { z } from "zod";

// ─────────────────────────────────────────────
// Inbound request
// ─────────────────────────────────────────────

export const RequestSchema = z
  .object({
    companyName: z.string().trim().min(1).max(200).optional(),
    ticker: z.string().trim().min(1).max(20).optional(),
    industry: z.string().max(200).optional(),
    // 2000 chars ≈ 500 tokens. Caps unbounded user input that would
    // otherwise inflate prompt cost and risk model-context overflow
    // (see also prompts.ts where this is re-truncated as defense-in-depth).
    additionalContext: z.string().max(2000).optional(),
    lang: z.enum(["en", "zh", "both"]).optional(),
    verbose: z.boolean().optional(),
  })
  .refine((d) => Boolean(d.companyName || d.ticker), {
    message: "Either companyName or ticker is required",
    path: ["companyName"],
  });

export type ValidatedRequest = z.infer<typeof RequestSchema>;

// ─────────────────────────────────────────────
// LLM output (DeepSeek analysis response)
// ─────────────────────────────────────────────

export const ForceSchema = z.object({
  score: z.number().int().min(1).max(10),
  analysis: z.string().trim().min(1).max(2000),
});

// Strict 5-key forces object. Any deviation (missing key, extra key,
// wrong shape) fails validation.
export const ForcesSchema = z.object({
  competitive_rivalry: ForceSchema,
  threat_of_new_entrants: ForceSchema,
  threat_of_substitutes: ForceSchema,
  supplier_power: ForceSchema,
  buyer_power: ForceSchema,
});

export const AnalysisOutputSchema = z.object({
  company: z.string().trim().min(1).optional(),
  industry: z.string().trim().min(1),
  forces: ForcesSchema,
  overall_assessment: z.string().trim().min(1).max(2000),
});

export type ValidatedAnalysis = z.infer<typeof AnalysisOutputSchema>;
export type ForcesObject = z.infer<typeof ForcesSchema>;

// Business-quality gate for the five-forces score distribution. Distinct
// from ForcesSchema, which only checks structure/range — this checks whether
// the model actually *differentiated* the forces (the "all 5s" template-copy
// failure mode). Returns a human-readable reason string when the distribution
// looks degenerate, or null when it passes.
//
// TODO(competitive): currently a no-op placeholder that always passes.
// Conservative first rule to add later: all five scores identical → fail.
// IMPORTANT when enabling: the failure semantics should be "retry once, then
// ACCEPT and flag in _meta (e.g. low_differentiation)", NOT a hard request
// failure — some companies legitimately have uniform, mid-range forces, and
// turning a structurally-valid analysis into a 500 hurts availability. The
// distribution-triggered retry should also raise temperature so it doesn't
// deterministically reproduce the same undifferentiated output.
export function validateForceScoreDistribution(
  _forces: ForcesObject,
): string | null {
  return null;
}

// Compact human-readable issue summary for error messages (top 3 issues).
export function summarizeZodIssues(issues: z.ZodIssue[]): string {
  return issues
    .slice(0, 3)
    .map((i) => `${i.path.join(".") || "root"}: ${i.message}`)
    .join("; ");
}
