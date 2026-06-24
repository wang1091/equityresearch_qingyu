// server/agent/taskPlanning/compileTasks.ts
//
// L1→L3 compiler (doc §4.1.1 normalize, §4.3 FetchStep, §10.4 legacy projection).
// Pure + deterministic; takes the LLM's RawTaskCandidate[] and produces the internal
// TaskExecutionPlan. NOT wired into resolvePlan/index — that is Phase 3.
//
//   RawTaskCandidate[]            (LLM minimal output)
//     → normalizeTask  → QueryTask[]   (stable ids, derived operation/period, metric)
//     → validateTask   → issues + status
//     → buildFetchSteps→ FetchStep[]   (capability registry; one task → ≥1 step)
//     → derive required_data + subjectTickers (summary fields, NOT the truth)

import {
  capabilitiesFor,
} from "./capabilityRegistry";
import {
  type FetchStep,
  type QueryTask,
  type RawTaskCandidate,
  type TaskExecutionPlan,
  type TaskOperation,
  type TaskPeriod,
} from "./types";
import type { DataSource } from "../intentSources";
import { validateRawCandidate } from "./schema";
import { planStatusFor, validateTask } from "./validateTasks";

const upper = (s: string) => s.toUpperCase().trim();

/** TS-derive the operation when the LLM didn't hint one (§4.1.1: lookup/compare are
 *  obvious forms; summarize/attribute/explain/verify must come from the LLM hint). */
function deriveOperation(raw: RawTaskCandidate): TaskOperation {
  if (raw.entities.some((e) => e.role === "peer")) return "compare";
  if (raw.operation) return raw.operation;
  return "lookup";
}

/** Normalize the LLM's explicitPeriod into a TaskPeriod (only when present). */
function derivePeriod(raw: RawTaskCandidate): TaskPeriod | undefined {
  const p = raw.explicitPeriod;
  if (!p || (p.year === undefined && p.quarter === undefined)) return undefined;
  if (p.quarter !== undefined) return { kind: "quarter", year: p.year, quarter: p.quarter };
  return { kind: "year", year: p.year };
}

/** RawTaskCandidate → QueryTask: stable id, normalized fields, metric resolution.
 *  An invalid explicit period (Q5, year 5) is REJECTED at the runtime schema layer
 *  and recorded as a blocking invalid_period issue with NO period — never silently
 *  coerced to "latest" (#4). */
export function normalizeTask(raw: unknown, index: number): QueryTask {
  const id = `task-${index + 1}`;
  const schemaErrors = validateRawCandidate(raw);
  const candidateErrors = schemaErrors.filter((e) => e.code === "invalid_candidate");
  if (candidateErrors.length > 0) {
    return {
      id,
      question: "",
      operation: "lookup",
      entities: [],
      issues: [{
        code: "invalid_candidate",
        severity: "blocking",
        message: candidateErrors.map((e) => `${e.field}: ${e.message}`).join("; "),
      }],
    };
  }

  const candidate = raw as RawTaskCandidate;
  const entities = candidate.entities.map((e) => ({ ticker: upper(e.ticker), role: e.role }));
  const known = candidate.metric.family !== "unknown";
  const periodErrors = schemaErrors.filter((e) => e.code === "invalid_period");
  const issues: QueryTask["issues"] = periodErrors.length > 0
    ? [{ code: "invalid_period", severity: "blocking", message: periodErrors.map((e) => e.message).join("; ") }]
    : [];
  return {
    id,
    question: candidate.question.trim(),
    operation: deriveOperation(candidate),
    entities,
    metric: known
      ? { family: candidate.metric.family as Exclude<RawTaskCandidate["metric"]["family"], "unknown">, name: candidate.metric.name }
      : undefined,
    unresolvedMetricName: known ? undefined : candidate.metric.name,
    period: periodErrors.length ? undefined : derivePeriod(candidate),
    evidenceConstraints: candidate.evidenceConstraints,
    evidenceRelation: candidate.evidenceRelation,
    issues,
  };
}

/** Top-level summary tickers: subject + peer only (mentioned / evidence_source
 *  excluded, §13.4). Used for the plan's `subjectTickers` and legacy UI. */
const subjectTickersOf = (task: QueryTask): string[] =>
  task.entities.filter((e) => e.role === "subject" || e.role === "peer").map((e) => e.ticker);

/**
 * Tickers to actually RETRIEVE for a task (#1) — distinct from the top-level summary.
 * For a legitimate cross-company attribution / read-through the answer lives in the
 * EVIDENCE company's document (NVDA's call), not the subject's, so we retrieve the
 * evidence_source. (Conflicting evidence cases are blocked by validateTask and never
 * reach fetch-building.) Otherwise — plain lookup, or a comparison — retrieve the
 * subject and any peers (a comparison wants both sides).
 */
const retrievalTickersOf = (task: QueryTask): string[] => {
  const byRole = (role: QueryTask["entities"][number]["role"]) =>
    task.entities.filter((e) => e.role === role).map((e) => e.ticker);
  const evidence = byRole("evidence_source");
  const rel = task.evidenceRelation;
  if (
    evidence.length > 0 &&
    (rel === "read_through" || rel === "commentary_about_subject" || rel === "comparison")
  ) {
    return [...new Set(evidence)];
  }
  return [...new Set([...byRole("subject"), ...byRole("peer")])];
};

/** Build the fetch steps for ONE task. A task with a blocking issue or no resolvable
 *  metric produces none (we don't fetch for something we'd have to clarify first, and
 *  an unregistered family stays unsupported — capabilitiesFor returns []).
 *  Preferred capability → primary step; remaining capabilities → fallbackOf chain.
 *
 *  params are PROVIDER-NEUTRAL logical params: a Phase 3 adapter maps them to actual
 *  provider API params (EARNINGS singular ticker+question, NEWS query, MARKET_DATA
 *  queryType, …). We therefore keep EVERYTHING the adapter could need — question,
 *  metric, period, evidenceConstraints — and do NOT shape them per provider here. */
export function buildFetchSteps(task: QueryTask): FetchStep[] {
  if (!task.metric) return [];
  if (task.issues.some((i) => i.severity === "blocking")) return [];

  const caps = capabilitiesFor(task.metric.family);
  if (caps.length === 0) return [];

  const tickers = retrievalTickersOf(task);
  const steps: FetchStep[] = [];
  let primaryId: string | undefined;

  caps.forEach((cap, i) => {
    const stepId = `${task.id}#${i + 1}`;
    const params: Record<string, unknown> = { tickers, question: task.question, metric: task.metric };
    if (cap.topic) params.topic = cap.topic;
    if (task.period) params.period = task.period;
    if (task.evidenceConstraints?.length) params.evidenceConstraints = task.evidenceConstraints;
    steps.push({
      id: stepId,
      taskId: task.id,
      source: cap.source,
      params,
      priority: cap.priority,
      fallbackOf: i === 0 ? undefined : primaryId,
    });
    if (i === 0) primaryId = stepId;
  });

  return steps;
}

/**
 * Compile RawTaskCandidate[] → TaskExecutionPlan. The single entry point.
 * required_data / subjectTickers here are DERIVED summary fields (doc §4.1 / §10.4),
 * never the planning truth — they exist for legacy consumers, logs and UI.
 */
export function compileTasks(raws: unknown): TaskExecutionPlan {
  const candidates = Array.isArray(raws) && raws.length > 0 ? raws : [raws];
  const tasks = candidates.map((raw, i) => {
    const task = normalizeTask(raw, i);
    // A structurally invalid candidate has no reliable semantics to validate further.
    // Period-only errors retain the valid task shape and still get semantic checks.
    if (!task.issues.some((issue) => issue.code === "invalid_candidate")) {
      task.issues.push(...validateTask(task));
    }
    return task;
  });

  const fetch = tasks.flatMap(buildFetchSteps);

  // required_data = sources of the PRIMARY (non-fallback) steps — what we intend to
  // call. Fallbacks are runtime alternates, not part of the planned source set.
  const requiredData = [
    ...new Set(fetch.filter((s) => !s.fallbackOf).map((s) => s.source)),
  ] as DataSource[];

  // subjectTickers = subject + peer only (mentioned / evidence_source excluded, §13.4).
  const subjectTickers = [...new Set(tasks.flatMap(subjectTickersOf))];

  return {
    tasks,
    fetch,
    requiredData,
    subjectTickers,
    status: planStatusFor(tasks),
  };
}
