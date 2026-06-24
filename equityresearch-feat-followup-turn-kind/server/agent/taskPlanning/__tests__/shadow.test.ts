import { describe, it, expect } from "vitest";
import { compareToRouting } from "../shadow";
import { parseValidCandidates } from "../schema";
import type { RawTaskCandidate } from "../types";

const raw = (r: Partial<RawTaskCandidate> & Pick<RawTaskCandidate, "question" | "entities" | "metric">): RawTaskCandidate => r;

describe("compareToRouting — shadow plan vs live routing tuple", () => {
  it("no tasks emitted → no_tasks record, everything counted as routing-only", () => {
    const cmp = compareToRouting(undefined, { required_data: ["EARNINGS"], tickers: ["COST"] });
    expect(cmp.plannerStatus).toBe("no_tasks");
    expect(cmp.tasksEmitted).toBe(0);
    expect(cmp.requiredDataMatch).toBe(false);
    expect(cmp.onlyInRouting).toEqual(["EARNINGS"]);
  });

  it("agreement: KPI task derives EARNINGS, matching routing (order-insensitive)", () => {
    const cmp = compareToRouting(
      [raw({ question: "members?", entities: [{ ticker: "COST", role: "subject" }], metric: { family: "operating_kpi" } })],
      { required_data: ["EARNINGS"], tickers: ["COST"] },
    );
    expect(cmp.plannerStatus).toBe("ready");
    expect(cmp.derivedRequiredData).toEqual(["EARNINGS"]);
    expect(cmp.requiredDataMatch).toBe(true);
    expect(cmp.tickersMatch).toBe(true);
    expect(cmp.onlyInTasks).toEqual([]);
    expect(cmp.onlyInRouting).toEqual([]);
  });

  it("divergence: tasks correctly split KPI→EARNINGS while routing over-fanned to PERFORMANCE", () => {
    // The §11 over-fragmentation: routing emitted PERFORMANCE(COST), the task plan did not.
    const cmp = compareToRouting(
      [raw({ question: "members?", entities: [{ ticker: "COST", role: "subject" }], metric: { family: "operating_kpi" } })],
      { required_data: ["EARNINGS", "PERFORMANCE"], tickers: ["COST"] },
    );
    expect(cmp.requiredDataMatch).toBe(false);
    expect(cmp.onlyInRouting).toEqual(["PERFORMANCE"]);
    expect(cmp.onlyInTasks).toEqual([]);
  });

  it("conflict task → clarification_required, derives no source (onlyInRouting flags the gap)", () => {
    const cmp = compareToRouting(
      [raw({
        question: "Costco members?",
        entities: [{ ticker: "COST", role: "subject" }, { ticker: "TSLA", role: "evidence_source" }],
        metric: { family: "operating_kpi" },
        evidenceRelation: "unrelated",
      })],
      { required_data: ["EARNINGS"], tickers: ["COST", "TSLA"] },
    );
    expect(cmp.plannerStatus).toBe("clarification_required");
    expect(cmp.derivedRequiredData).toEqual([]);
    expect(cmp.onlyInRouting).toEqual(["EARNINGS"]);
  });
});

describe("parseValidCandidates — record-only shadow parse", () => {
  it("keeps structurally-valid candidates, drops & counts malformed", () => {
    const { valid, rejectedCount } = parseValidCandidates([
      { question: "ok", entities: [{ ticker: "COST", role: "subject" }], metric: { family: "operating_kpi" } },
      { entities: [], metric: { family: "operating_kpi" } }, // missing question → structural
      { question: "no metric", entities: [{ ticker: "AAPL", role: "subject" }] }, // missing metric
    ]);
    expect(valid).toHaveLength(1);
    expect(rejectedCount).toBe(2);
  });

  it("a period-only error is KEPT (well-formed; compiler flags invalid_period later)", () => {
    const { valid, rejectedCount } = parseValidCandidates([
      {
        question: "Q5 revenue",
        entities: [{ ticker: "COST", role: "subject" }],
        metric: { family: "statement_metric" },
        explicitPeriod: { quarter: 5 },
      },
    ]);
    expect(valid).toHaveLength(1);
    expect(rejectedCount).toBe(0);
  });

  it("non-array (or absent) → empty, never throws", () => {
    expect(parseValidCandidates(undefined)).toEqual({ valid: [], rejectedCount: 0 });
    expect(parseValidCandidates("nope")).toEqual({ valid: [], rejectedCount: 0 });
  });
});
