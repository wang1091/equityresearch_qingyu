// server/agent/taskPlanning/validateTasks.ts
//
// L2 task validation (doc §4.1.2 / §8.1). Given normalized QueryTask[], produce
// per-task issues and reduce to a plan status. Pure + deterministic — no LLM, no
// fetch. This is where the §11 "DEFERRED" assertions the routing tuple can't see
// (clarification_required for an evidence/subject conflict, ambiguous_metric for
// bare "users") actually get enforced.
//
// THE CENTRAL RULE (§4.1.2): evidence_subject_mismatch is a SEMANTIC judgment, NOT
// `evidenceTicker !== subjectTicker`. Ticker inequality alone never blocks — a peer
// comparison and a legitimate cross-company read-through both have differing
// tickers. The conflict is: the cited evidence cannot plausibly contain the asked
// answer. We decide that from (evidenceRelation × metric family), not from string
// equality.

import type { MetricFamily, PlanStatus, QueryTask, TaskIssue } from "./types";
import { capabilitiesFor } from "./capabilityRegistry";

const subjectsOf = (t: QueryTask) => t.entities.filter((e) => e.role === "subject");
const evidenceSourcesOf = (t: QueryTask) => t.entities.filter((e) => e.role === "evidence_source");

/** Families whose answer can plausibly live in another company's commentary. */
const EXTERNAL_EVIDENCE_COMPATIBLE_FAMILIES: ReadonlySet<MetricFamily> = new Set([
  "management_commentary",
  "news_event",
]);

/** Validate one task, returning the issues to merge into task.issues. */
export function validateTask(task: QueryTask): TaskIssue[] {
  const issues: TaskIssue[] = [];
  const subjects = subjectsOf(task);

  // ── subject presence ──
  if (subjects.length === 0) {
    issues.push({ code: "ambiguous_subject", severity: "blocking", message: "no subject entity" });
  } else if (subjects.length > 1 && task.operation !== "compare" && !task.evidenceRelation) {
    // Two unrelated subjects in one task with no comparison/relation → the parser
    // probably should have split them. Warn (not block) — it is a parse smell.
    issues.push({
      code: "multi_subject_without_relation",
      severity: "warning",
      message: "multiple subjects without comparison/relation",
    });
  }

  // ── metric presence / resolvability ──
  if (!task.metric) {
    issues.push(
      task.unresolvedMetricName
        ? {
            code: "ambiguous_metric",
            severity: "blocking",
            message: `metric "${task.unresolvedMetricName}" is under-specified (which caliber?)`,
          }
        : { code: "missing_metric", severity: "blocking", message: "no metric family" },
    );
  } else if (capabilitiesFor(task.metric.family).length === 0) {
    // Plan-time capability guard (§8.1): a family with no registered source can't be
    // executed. With the v1 registry every family is covered, so this only fires for
    // a future family added without a capability — fail closed rather than fetch blind.
    issues.push({
      code: "unsupported_metric_source",
      severity: "blocking",
      message: `no capability registered for ${task.metric.family}`,
    });
  }

  // ── evidence / subject relation (§4.1.2) ──
  // The verdict is NEVER ticker equality. Two independent gates:
  //  (a) the LLM's relation signal — unrelated/unclear means the LLM itself reports
  //      no coherent bridge / uncertainty → clarify, REGARDLESS of ticker (a relation
  //      signal must not be silently ignored just because the tickers happen to match);
  //  (b) family compatibility — only commentary/news answers may live in an external
  //      company's evidence; statement/operating/market/valuation facts may not.
  const evidence = evidenceSourcesOf(task);
  const rel = task.evidenceRelation;
  const representedCompanies = new Set([...subjects, ...evidence].map((entity) => entity.ticker));
  const unmatchedCompanyConstraint = task.evidenceConstraints?.find(
    (constraint) =>
      constraint.kind === "company" &&
      !representedCompanies.has(constraint.value.toUpperCase().trim()),
  );

  if (rel === "unrelated" || rel === "unclear") {
    issues.push({
      code: "evidence_subject_mismatch",
      severity: "blocking",
      message: `cited evidence relation "${rel}" → clarify`,
    });
  } else if (unmatchedCompanyConstraint) {
    issues.push({
      code: "evidence_subject_mismatch",
      severity: "blocking",
      message: `company evidence constraint "${unmatchedCompanyConstraint.value}" has no matching entity`,
    });
  } else if (evidence.length > 0) {
    const crossEntity = evidence.some((ev) => !subjects.some((s) => s.ticker === ev.ticker));
    const externalEvidenceCompatible = task.metric
      ? EXTERNAL_EVIDENCE_COMPATIBLE_FAMILIES.has(task.metric.family)
      : false;

    if (rel === "same_subject") {
      // The LLM says it is really the subject's own evidence → trust the relation
      // over any ticker mismatch, never block (§4.1.2 rule 3).
    } else if (!rel) {
      // No stated relation: only a problem when the evidence is a DIFFERENT company
      // (a company's own call cited with no relation is the normal "based on its
      // own call" case — legal).
      if (crossEntity) {
        issues.push({
          code: "evidence_subject_mismatch",
          severity: "blocking",
          message: "cross-company evidence with no stated relation → clarify",
        });
      }
    } else if (crossEntity && !externalEvidenceCompatible) {
      // External commentary can answer commentary/news tasks, but cannot substitute
      // statement, operating, market, or valuation facts about another company.
      issues.push({
        code: "evidence_subject_mismatch",
        severity: "blocking",
        message: "external evidence cannot substitute the subject's own reported figure",
      });
    }
    // else: management_commentary + commentary/read_through/comparison → legal
    // cross-company read-through (NVDA commentary → how is AMD positioned). No issue.
  }

  return issues;
}

/** Reduce all task issues to the overall plan status (unsupported > clarify > ready). */
export function planStatusFor(tasks: QueryTask[]): PlanStatus {
  const all = tasks.flatMap((t) => t.issues);
  if (all.some((i) => i.severity === "blocking" && i.code === "unsupported_metric_source")) {
    return "unsupported";
  }
  if (all.some((i) => i.severity === "blocking")) return "clarification_required";
  return "ready";
}
