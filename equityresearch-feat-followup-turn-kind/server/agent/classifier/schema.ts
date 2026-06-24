// Client-side zod contract for the classifier LLM output.
//
// DeepSeek can only guarantee *syntactic* JSON (response_format:{json_object});
// it does NOT support strict provider-enforced json_schema, and the per-source
// `api_params` is polymorphic (EARNINGS topics, array vs single ticker, …), which
// doesn't fit a clean strict schema anyway. So the real structural contract lives
// HERE, provider-agnostically. See docs/reference/classifier-output-structure.md.
//
// LENIENT BY DESIGN: this validates the top-level shape and logs mismatches for
// observability. It is NOT a hard gate — `normalizeClassifierResult` remains the
// coercion layer. Hard-rejecting a slightly-imperfect-but-usable result would only
// push more queries into the keyword fallback (the very thing bug 005 is about).
import { z } from "zod";

export const classifierOutputSchema = z
  .object({
    tickers: z.array(z.string()).optional(),
    required_data: z.array(z.string()).optional(),
    intents: z.array(z.string()).optional(),
    primary_focus: z.string().optional(),
    need_api: z.boolean().optional(),
    confidence: z.number().optional(),
    reasoning: z.string().optional(),
    // api_params values are polymorphic per source — normalize shapes them.
    api_params: z.record(z.unknown()).optional(),
  })
  .passthrough();

/** Validate for observability only. Returns ok + a compact issue string on mismatch. */
export function validateClassifierOutput(obj: unknown): { ok: boolean; issues?: string } {
  const r = classifierOutputSchema.safeParse(obj);
  if (r.success) return { ok: true };
  return {
    ok: false,
    issues: r.error.issues
      .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("; ")
      .slice(0, 300),
  };
}
