import { describe, it, expect } from "vitest";
import { validateTask, planStatusFor } from "../validateTasks";
import type { EvidenceRelation, MetricFamily, QueryTask, TaskIssue } from "../types";

// Direct unit tests for the validator — the semantic core of task-centric (the
// §4.1.2 evidence_subject_mismatch judgment + the issue→status reducer). The
// compiler test exercises this through the full pipeline on representative §11
// rows; here we test validateTask in isolation and sweep the FULL truth table so a
// regression in the (relation × family) logic can't hide behind compile/fetch code.

const task = (over: Partial<QueryTask>): QueryTask => ({
  id: "task-1",
  question: "q",
  operation: "lookup",
  entities: [{ ticker: "COST", role: "subject" }],
  metric: { family: "operating_kpi" },
  issues: [],
  ...over,
});

const codes = (issues: TaskIssue[]) => issues.map((i) => i.code);
const hasBlocking = (issues: TaskIssue[], code: string) =>
  issues.some((i) => i.code === code && i.severity === "blocking");

// ── §4.1.2 truth table, exhaustive ──────────────────────────────────────────
// A cross-entity evidence_source (subject COST, evidence TSLA). The mismatch
// verdict is a function of (evidenceRelation × metric family) ONLY — never ticker
// equality. Direct own facts (statement/operating_kpi) can't be proven by an
// external company's evidence unless the relation IS same_subject. Only families
// whose answer can actually live in external commentary tolerate cross-company
// read-through/commentary/comparison.
const EXTERNAL_EVIDENCE_INCOMPATIBLE: MetricFamily[] = [
  "statement_metric",
  "operating_kpi",
  "market_metric",
  "valuation_metric",
];
const EXTERNAL_EVIDENCE_COMPATIBLE: MetricFamily[] = [
  "management_commentary",
  "news_event",
];
const RELATIONS: Array<EvidenceRelation | undefined> = [
  "same_subject",
  "commentary_about_subject",
  "comparison",
  "read_through",
  "unrelated",
  "unclear",
  undefined,
];

const expectMismatch = (family: MetricFamily, rel: EvidenceRelation | undefined): boolean => {
  if (rel === "same_subject") return false; // trust relation over ticker mismatch
  if (rel === "unrelated" || rel === "unclear" || rel === undefined) return true; // no coherent bridge
  return EXTERNAL_EVIDENCE_INCOMPATIBLE.includes(family);
};

describe("validateTask — §4.1.2 evidence_subject_mismatch truth table (cross-entity evidence)", () => {
  for (const family of [...EXTERNAL_EVIDENCE_INCOMPATIBLE, ...EXTERNAL_EVIDENCE_COMPATIBLE]) {
    for (const rel of RELATIONS) {
      const want = expectMismatch(family, rel);
      it(`${family} × ${rel ?? "no-relation"} → ${want ? "CONFLICT" : "legal"}`, () => {
        const issues = validateTask(
          task({
            entities: [
              { ticker: "COST", role: "subject" },
              { ticker: "TSLA", role: "evidence_source" },
            ],
            metric: { family },
            evidenceRelation: rel,
          }),
        );
        expect(hasBlocking(issues, "evidence_subject_mismatch")).toBe(want);
      });
    }
  }
});

describe("validateTask — evidence relation vs ticker (the #5 fix)", () => {
  it("no evidence_source → never an evidence mismatch (even with a peer of a different ticker)", () => {
    const issues = validateTask(
      task({
        operation: "compare",
        entities: [
          { ticker: "AMD", role: "subject" },
          { ticker: "NVDA", role: "peer" },
        ],
        metric: { family: "statement_metric" },
        evidenceRelation: undefined,
      }),
    );
    expect(codes(issues)).not.toContain("evidence_subject_mismatch");
  });

  it("relation=unclear blocks even when the malformed candidate omitted evidence_source", () => {
    const issues = validateTask(task({ evidenceRelation: "unclear" }));
    expect(hasBlocking(issues, "evidence_subject_mismatch")).toBe(true);
  });

  // SAME-ticker evidence_source: the relation signal must STILL be honored — a broken
  // bridge can't be masked by the tickers happening to match (the bug #5 fixed; the
  // old test wrongly asserted "no conflict" here).
  it("same ticker + relation=unrelated → CONFLICT (relation signal not ignored)", () => {
    const issues = validateTask(
      task({
        entities: [
          { ticker: "COST", role: "subject" },
          { ticker: "COST", role: "evidence_source" },
        ],
        metric: { family: "operating_kpi" },
        evidenceRelation: "unrelated",
      }),
    );
    expect(hasBlocking(issues, "evidence_subject_mismatch")).toBe(true);
  });

  it("same ticker + relation=unclear → CONFLICT (§358 unclear → clarify)", () => {
    const issues = validateTask(
      task({
        entities: [
          { ticker: "AAPL", role: "subject" },
          { ticker: "AAPL", role: "evidence_source" },
        ],
        metric: { family: "operating_kpi" },
        evidenceRelation: "unclear",
      }),
    );
    expect(hasBlocking(issues, "evidence_subject_mismatch")).toBe(true);
  });

  it("same ticker + NO relation → legal (the normal 'based on its own call' case)", () => {
    const issues = validateTask(
      task({
        entities: [
          { ticker: "COST", role: "subject" },
          { ticker: "COST", role: "evidence_source" },
        ],
        metric: { family: "operating_kpi" },
        evidenceRelation: undefined,
      }),
    );
    expect(codes(issues)).not.toContain("evidence_subject_mismatch");
  });

  it("same ticker + same_subject → legal", () => {
    const issues = validateTask(
      task({
        entities: [
          { ticker: "COST", role: "subject" },
          { ticker: "COST", role: "evidence_source" },
        ],
        metric: { family: "operating_kpi" },
        evidenceRelation: "same_subject",
      }),
    );
    expect(codes(issues)).not.toContain("evidence_subject_mismatch");
  });
});

describe("validateTask — subject presence", () => {
  it("no subject → ambiguous_subject (blocking)", () => {
    const issues = validateTask(task({ entities: [] }));
    expect(hasBlocking(issues, "ambiguous_subject")).toBe(true);
  });

  it("two subjects, lookup, no relation → multi_subject_without_relation (warning, not blocking)", () => {
    const issues = validateTask(
      task({
        entities: [
          { ticker: "COST", role: "subject" },
          { ticker: "TGT", role: "subject" },
        ],
      }),
    );
    const issue = issues.find((i) => i.code === "multi_subject_without_relation");
    expect(issue?.severity).toBe("warning");
  });

  it("two subjects but operation=compare → no multi_subject warning", () => {
    const issues = validateTask(
      task({
        operation: "compare",
        entities: [
          { ticker: "COST", role: "subject" },
          { ticker: "TGT", role: "subject" },
        ],
      }),
    );
    expect(codes(issues)).not.toContain("multi_subject_without_relation");
  });
});

describe("validateTask — metric resolvability", () => {
  it("metric undefined + unresolvedMetricName → ambiguous_metric (blocking)", () => {
    const issues = validateTask(task({ metric: undefined, unresolvedMetricName: "users" }));
    expect(hasBlocking(issues, "ambiguous_metric")).toBe(true);
    expect(codes(issues)).not.toContain("missing_metric");
  });

  it("metric undefined + no name → missing_metric (blocking)", () => {
    const issues = validateTask(task({ metric: undefined, unresolvedMetricName: undefined }));
    expect(hasBlocking(issues, "missing_metric")).toBe(true);
    expect(codes(issues)).not.toContain("ambiguous_metric");
  });

  it("a resolved, registered metric produces no metric issue", () => {
    const issues = validateTask(task({ metric: { family: "statement_metric", name: "revenue" } }));
    expect(codes(issues)).not.toContain("ambiguous_metric");
    expect(codes(issues)).not.toContain("missing_metric");
    expect(codes(issues)).not.toContain("unsupported_metric_source");
  });
});

// ── issue → status reducer ───────────────────────────────────────────────────
// unsupported_metric_source is currently unreachable through validateTask (every
// real MetricFamily has a capability), so the precedence is tested on the reducer
// directly with synthetic issues — that's the unit under test here.
describe("planStatusFor — unsupported > clarification > ready", () => {
  const withIssues = (issues: TaskIssue[]): QueryTask => task({ issues });

  it("no blocking issues → ready", () => {
    expect(planStatusFor([withIssues([{ code: "multi_subject_without_relation", severity: "warning" }])])).toBe(
      "ready",
    );
  });

  it("a blocking issue (non-unsupported) → clarification_required", () => {
    expect(planStatusFor([withIssues([{ code: "evidence_subject_mismatch", severity: "blocking" }])])).toBe(
      "clarification_required",
    );
  });

  it("unsupported_metric_source wins even alongside another blocking issue", () => {
    expect(
      planStatusFor([
        withIssues([
          { code: "ambiguous_subject", severity: "blocking" },
          { code: "unsupported_metric_source", severity: "blocking" },
        ]),
      ]),
    ).toBe("unsupported");
  });

  it("status is computed across ALL tasks, not just the first", () => {
    expect(
      planStatusFor([
        withIssues([]),
        withIssues([{ code: "evidence_subject_mismatch", severity: "blocking" }]),
      ]),
    ).toBe("clarification_required");
  });

  it("empty plan → ready", () => {
    expect(planStatusFor([])).toBe("ready");
  });
});
