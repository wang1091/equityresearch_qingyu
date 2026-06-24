// server/agent/taskPlanning/types.ts
//
// The task-centric contract, materialized as TS types. This is the code form of
// the FROZEN v1 contract in docs/TASK_CENTRIC_QUERY_PLANNING.md §4.1.1 / §4.1.2.
// If this file and that table ever drift, the DOC is authoritative — fix the code
// back to the table, do not silently widen the LLM-required subset here.
//
// Two distinct shapes:
//   RawTaskCandidate — the MINIMAL subset the LLM (prod 9B) must emit.
//   QueryTask        — the TS-normalized, validated internal logical plan.
//
// Phase 2 scope: pure functions only (compile/validate/registry). Nothing here is
// wired into resolvePlan/index yet — that is Phase 3, gated on turn_kind 4b.

import type { DataSource } from "../intentSources";

export type TaskOperation =
  | "lookup"
  | "summarize"
  | "compare"
  | "explain"
  | "verify"
  | "attribute";

export type EntityRole = "subject" | "peer" | "evidence_source" | "mentioned";

export type MetricFamily =
  | "statement_metric"
  | "market_metric"
  | "valuation_metric"
  | "operating_kpi"
  | "management_commentary"
  | "news_event";

/** Direct own facts — figures a company reports about itself. An EXTERNAL company's
 *  document cannot stand in for these (see §4.1.2 evidence_subject_mismatch). */
export const DIRECT_OWN_FACT_FAMILIES: ReadonlySet<MetricFamily> = new Set([
  "statement_metric",
  "operating_kpi",
]);

/** LLM's semantic judgment of how the cited evidence relates to the subject. */
export type EvidenceRelation =
  | "same_subject"
  | "commentary_about_subject"
  | "comparison"
  | "read_through"
  | "unrelated"
  | "unclear";

export interface TaskEntity {
  ticker: string;
  role: EntityRole;
}

export interface EvidenceConstraint {
  kind: "document_type" | "company" | "source";
  value: string;
}

/**
 * RawTaskCandidate — the LLM's minimal output (§4.1.1). `metric.family` may be
 * "unknown" when the LLM is genuinely unsure; it must NOT hard-guess to satisfy
 * the schema (the TS validator turns unknown into a clarification, not a wrong
 * fetch). Everything not present here is TS-derived.
 */
export interface RawTaskCandidate {
  question: string;
  entities: TaskEntity[];
  metric: { family: MetricFamily | "unknown"; name?: string };
  operation?: TaskOperation;
  explicitPeriod?: { year?: number; quarter?: number };
  evidenceConstraints?: EvidenceConstraint[];
  evidenceRelation?: EvidenceRelation;
}

// TS-DERIVED issue codes (validator/schema output). These are NOT part of the frozen
// 9B-required subset (§4.1.1 freeze covers the LLM's *input* fields only), so this
// enum may grow as TS validation deepens — keep it in sync with the doc's issue list.
export type TaskIssueCode =
  | "evidence_subject_mismatch"
  | "unsupported_metric_source"
  | "ambiguous_subject"
  | "ambiguous_metric"
  | "missing_metric"
  | "multi_subject_without_relation"
  | "invalid_candidate"
  | "invalid_period";

export interface TaskIssue {
  code: TaskIssueCode;
  severity: "warning" | "blocking";
  message?: string;
}

export interface TaskPeriod {
  kind: "latest" | "quarter" | "year" | "range";
  year?: number;
  quarter?: number;
  from?: string;
  to?: string;
}

/**
 * QueryTask — the normalized internal logical plan. `metric` is absent when the
 * LLM emitted family "unknown"; `unresolvedMetricName` then carries the raw word
 * (if any) so the validator can tell ambiguous_metric ("users" — which KPI?)
 * apart from missing_metric (no metric at all). Neither is LLM-facing.
 */
export interface QueryTask {
  id: string;
  question: string;
  operation: TaskOperation;
  entities: TaskEntity[];
  metric?: { family: MetricFamily; name?: string; qualifiers?: Record<string, string> };
  unresolvedMetricName?: string;
  period?: TaskPeriod;
  evidenceConstraints?: EvidenceConstraint[];
  evidenceRelation?: EvidenceRelation;
  issues: TaskIssue[];
}

export interface FetchStep {
  id: string;
  taskId: string;
  source: DataSource;
  params: Record<string, unknown>;
  priority: number;
  /** Set when this step is a runtime fallback for another step (same taskId). */
  fallbackOf?: string;
}

export type PlanStatus = "ready" | "clarification_required" | "unsupported";

export interface TaskExecutionPlan {
  tasks: QueryTask[];
  fetch: FetchStep[];
  /** Derived: the sources of the primary (non-fallback) fetch steps. */
  requiredData: DataSource[];
  /** Derived: subject + peer tickers only (NOT mentioned / evidence_source — §13.4). */
  subjectTickers: string[];
  status: PlanStatus;
}

/**
 * TaskResult — Phase 4 execution seam. Defined here so the contract is complete,
 * but NOT produced by anything in Phase 2 (the compiler stops at FetchStep[]).
 */
export interface TaskResult {
  taskId: string;
  fetchStepId: string;
  source: DataSource;
  ticker?: string;
  success: boolean;
  answer?: unknown;
  evidence?: unknown[];
  error?: string;
}
