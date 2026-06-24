// server/agent/taskPlanning/schema.ts
//
// Runtime schema validation of the LLM's RawTaskCandidate. The input is untrusted
// JSON, so validate the complete required shape before normalization reads fields.
// Invalid periods remain distinguishable from other malformed candidate fields.
//
// Intended use: a Phase 3 caller runs this BEFORE compiling and, on errors, retries
// the LLM or asks the user to clarify. Until that retry/clarify entry exists,
// compileTasks consults this and fails the offending task CLOSED (a blocking
// invalid_candidate/invalid_period issue → no FetchStep) — never a silent drop.

import { z } from "zod";
import type { RawTaskCandidate } from "./types";

export interface RawCandidateError {
  field: string;
  message: string;
  code: "invalid_candidate" | "invalid_period";
}

// Generous static bounds — reject obvious garbage (year: 5, quarter: 13) without
// coupling to the wall clock (keeps validation deterministic for tests).
const MIN_YEAR = 1990;
const MAX_YEAR = 2100;

const RAW_TASK_CANDIDATE_SCHEMA = z.object({
  question: z.string().trim().min(1),
  entities: z.array(
    z.object({
      ticker: z.string().trim().min(1),
      role: z.enum(["subject", "peer", "evidence_source", "mentioned"]),
    }),
  ),
  metric: z.object({
    family: z.enum([
      "statement_metric",
      "market_metric",
      "valuation_metric",
      "operating_kpi",
      "management_commentary",
      "news_event",
      "unknown",
    ]),
    name: z.string().trim().min(1).optional(),
  }),
  operation: z.enum(["lookup", "summarize", "compare", "explain", "verify", "attribute"]).optional(),
  explicitPeriod: z
    .object({
      year: z.number().int().min(MIN_YEAR).max(MAX_YEAR).optional(),
      quarter: z.number().int().min(1).max(4).optional(),
    })
    .optional(),
  evidenceConstraints: z
    .array(
      z.object({
        kind: z.enum(["document_type", "company", "source"]),
        value: z.string().trim().min(1),
      }),
    )
    .optional(),
  evidenceRelation: z
    .enum(["same_subject", "commentary_about_subject", "comparison", "read_through", "unrelated", "unclear"])
    .optional(),
});

/** Validate one untrusted candidate. Empty errors means it is safe to normalize. */
export function validateRawCandidate(raw: unknown): RawCandidateError[] {
  const parsed = RAW_TASK_CANDIDATE_SCHEMA.safeParse(raw);
  if (parsed.success) return [];
  return parsed.error.issues.map((issue) => ({
    field: issue.path.join(".") || "candidate",
    message: issue.message,
    code: issue.path[0] === "explicitPeriod" ? "invalid_period" : "invalid_candidate",
  }));
}

/**
 * Parse an untrusted LLM `tasks` array into the STRUCTURALLY-valid candidates (Phase 1
 * shadow plumbing). A period-only error is kept — the candidate is well-formed and the
 * compiler turns the bad period into an invalid_period issue downstream — but a
 * structurally invalid one (missing question/entities/metric) is dropped and counted.
 * Never throws; a non-array yields an empty result.
 */
export function parseValidCandidates(raw: unknown): { valid: RawTaskCandidate[]; rejectedCount: number } {
  if (!Array.isArray(raw)) return { valid: [], rejectedCount: 0 };
  const valid: RawTaskCandidate[] = [];
  let rejectedCount = 0;
  for (const item of raw) {
    if (validateRawCandidate(item).some((e) => e.code === "invalid_candidate")) rejectedCount++;
    else valid.push(item as RawTaskCandidate);
  }
  return { valid, rejectedCount };
}
