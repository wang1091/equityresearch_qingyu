/**
 * Schema for the upstream Stock Picker service response.
 *
 * This response is produced by an LLM-backed scoring engine, so it is UNTRUSTED:
 * the backend must run it through this schema (see ./validate) before building a
 * card payload or feeding it to the generator. The TS type is inferred from the
 * schema so the two can never drift.
 *
 * Objects use `.passthrough()` — the upstream may add fields we don't model yet;
 * we validate the shape we render and keep the rest rather than rejecting it.
 */
import { z } from "zod";

const stringList = z.array(z.string());

export const stockPickerResponseSchema = z
  .object({
    intent: z.enum(["trending", "analysis"]).optional(),
    language: z.enum(["en", "zh"]).optional(),
    ticker: z.string().optional(),
    recommendation: z.string().optional(),
    confidence: z.string().optional(),
    finalScore: z.number().optional(),
    sentimentScore: z.number().optional(),
    earningsScore: z.number().optional(),
    financialScore: z.number().optional(),
    valuationScore: z.number().optional(),
    detailedAnswer: z.string().optional(),
    answer: z.string().optional(),
    summary: z.unknown().optional(),
    sentimentBreakdown: z
      .object({
        summary: z.string().optional(),
        key_drivers: stringList.optional(),
        risk_flags: stringList.optional(),
      })
      .passthrough()
      .optional(),
    earningsBreakdown: z
      .object({
        summary: z.string().optional(),
        key_positives: stringList.optional(),
        key_risks: stringList.optional(),
      })
      .passthrough()
      .optional(),
    financialBreakdown: z
      .object({
        summary: z.string().optional(),
        strengths: stringList.optional(),
        weaknesses: stringList.optional(),
      })
      .passthrough()
      .optional(),
    valuationBreakdown: z
      .object({
        summary: z.string().optional(),
        valuation_position: z.string().optional(),
        upside_downside_summary: z.string().optional(),
        key_assumptions: stringList.optional(),
      })
      .passthrough()
      .optional(),
    engineBreakdown: z
      .object({ engines: z.array(z.unknown()).optional() })
      .passthrough()
      .optional(),
    category: z
      .object({
        id: z.string().optional(),
        label: z.string().optional(),
        description: z.string().optional(),
        stocks: z
          .array(
            z
              .object({
                ticker: z.string().optional(),
                companyName: z.string().optional(),
                price: z.number().optional(),
                changePercent: z.number().optional(),
                categoryRank: z.number().optional(),
                discussion_highlights: stringList.optional(),
              })
              .passthrough(),
          )
          .optional(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough();

/** Raw per-ticker (or per-list) result from the upstream Stock Picker service. */
export type StockPickerResponse = z.infer<typeof stockPickerResponseSchema>;
