// server/agent/structuredOutput.ts
// Single source of truth for the generator's structured-output CONTRACT.
//
// Two prompt variants (EN/ZH, in generatorPrompts.ts) used to emit divergent
// field names for the decision block — EN: `Analysis_Decision` + `"red flags"`,
// ZH: `investment_decision` + `red_flags`. This module pins ONE canonical shape
// (zod schema below), folds the legacy/EN variants onto it (canonicalizeStructured),
// and adds the lightweight post-validation that gives "NEVER fabricate" teeth
// (validateStructuredOutput). The client then only ever sees the canonical shape.
import { z } from "zod";

// Canonical schema. Field NAMES + structure are fixed here; natural-language
// VALUES (verdict text, summaries, reasoning) stay in the response language.
// Lenient (.passthrough(), everything optional) — the LLM varies, and validation
// is non-fatal: we never blank an answer over a schema miss.
const moduleSchema = z
  .object({
    module: z.string().optional(),
    icon: z.string().optional(),
    rating: z.string().optional(),
    reasoning_steps: z.array(z.string()).optional(),
    conclusion: z.string().optional(),
    sources: z.array(z.string()).optional(),
  })
  .passthrough();

export const StructuredOutputSchema = z
  .object({
    query_understanding: z
      .object({
        intent: z.string().optional(),
        tickers: z.array(z.string()).optional(),
        data_sources_used: z.array(z.string()).optional(),
        reasoning: z.string().optional(),
      })
      .passthrough()
      .optional(),
    modules: z.array(moduleSchema).optional(),
    evidence_graph: z.record(z.any()).optional(),
    investment_decision: z
      .object({
        verdict: z.string().optional(),
        conviction: z.string().optional(),
        price_target: z.string().optional(),
        current_price: z.string().optional(),
        upside_downside: z.string().optional(),
        time_horizon: z.string().optional(),
        summary: z.string().optional(),
        red_flags: z.string().optional(),
      })
      .passthrough()
      .optional(),
    key_insights: z.array(z.string()).optional(),
    // suggested_followups removed: follow-ups now come solely from the dedicated
    // Follow-Up Engine (/api/follow-ups), not the generator's structured output.
  })
  .passthrough();

export type StructuredOutput = z.infer<typeof StructuredOutputSchema>;

// Union of every per-module rating token (News POSITIVE/NEUTRAL/NEGATIVE,
// Earnings/Data STRONG/MODERATE/WEAK, Valuation UNDERVALUED/FAIR/OVERVALUED,
// Rumor VERIFIED/UNCERTAIN/MISLEADING, Industry STRONG/AVERAGE/WEAK).
// Module-agnostic on purpose: catches garbage ratings without needing to map
// (possibly localized) module names.
export const VALID_RATINGS: ReadonlySet<string> = new Set([
  "POSITIVE", "NEUTRAL", "NEGATIVE",
  "VERIFIED", "UNCERTAIN", "MISLEADING",
  "STRONG", "MODERATE", "WEAK",
  "UNDERVALUED", "FAIR", "OVERVALUED",
  "AVERAGE",
]);

/**
 * Fold legacy / EN-variant field names onto the canonical shape so downstream
 * (and the client) only ever see one spelling. Mutates and returns `parsed`.
 */
export function canonicalizeStructured(parsed: Record<string, any>): Record<string, any> {
  if (!parsed || typeof parsed !== "object") return parsed;

  // EN prompt emitted `Analysis_Decision`; canonical is `investment_decision`.
  if (parsed.Analysis_Decision && !parsed.investment_decision) {
    parsed.investment_decision = parsed.Analysis_Decision;
  }
  delete parsed.Analysis_Decision;

  const dec = parsed.investment_decision;
  if (dec && typeof dec === "object") {
    // EN prompt emitted `"red flags"` (space); canonical is `red_flags`.
    if (dec["red flags"] !== undefined && dec.red_flags === undefined) {
      dec.red_flags = dec["red flags"];
    }
    delete dec["red flags"];
  }

  return parsed;
}

/**
 * Lightweight, NON-FATAL post-validation — the teeth behind "NEVER fabricate".
 * Returns a list of human-readable warnings (empty = clean). When
 * `retrievedSources` is given, any `data_sources_used` entry that wasn't actually
 * retrieved is flagged AND pruned (that is literal fabrication). Modules are
 * never dropped — we don't want a schema miss to blank a real answer.
 */
export function validateStructuredOutput(
  parsed: Record<string, any>,
  retrievedSources?: string[],
): string[] {
  const warnings: string[] = [];
  if (!parsed || typeof parsed !== "object") return ["output is not an object"];

  if (Array.isArray(parsed.modules)) {
    parsed.modules.forEach((m: any, i: number) => {
      if (m?.rating && !VALID_RATINGS.has(String(m.rating).toUpperCase())) {
        warnings.push(`module[${i}] "${m.module ?? "?"}" rating "${m.rating}" not in enum`);
      }
      // Per-module `sources` is no longer requested from the LLM — source
      // attribution is TS-derived (provenance.ts), so an empty/missing module
      // sources field is expected and not flagged.
    });
  }

  if (retrievedSources) {
    const retrieved = new Set(retrievedSources.map((s) => s.toUpperCase()));
    const qu = parsed.query_understanding;
    const used = qu?.data_sources_used;
    if (Array.isArray(used)) {
      const fabricated = used.filter((s: any) => !retrieved.has(String(s).toUpperCase()));
      if (fabricated.length) {
        warnings.push(`data_sources_used claims un-retrieved sources: ${fabricated.join(", ")}`);
        qu.data_sources_used = used.filter((s: any) => retrieved.has(String(s).toUpperCase()));
      }
    }
  }

  return warnings;
}
