import { describe, it, expect } from "vitest";
import { normalizeClassifierResult } from "../classifier/normalize";

// Covers the normalize → ClassificationResult chain for the Phase 1 shadow `tasks`
// field (地基块 #4) — specifically the part the routing→HTTP→shadow path could not:
// that malformed candidates are dropped AND counted (tasksRejectedCount), so the
// rejection rate is actually recoverable downstream. Routing fields must be untouched.

const ctx = { query: "q", dateString: "2026-06-23" };
const base = {
  required_data: ["EARNINGS"],
  primary_focus: "EARNINGS",
  tickers: ["COST"],
  need_api: true,
  api_params: { EARNINGS: { ticker: "COST" } },
};

const validTask = {
  question: "How many Costco members?",
  entities: [{ ticker: "COST", role: "subject" }],
  metric: { family: "operating_kpi" },
};

describe("normalize — Phase 1 shadow tasks plumbing", () => {
  it("keeps valid tasks and reports rejectedCount for a partially-malformed array", () => {
    const out = normalizeClassifierResult(
      {
        ...base,
        tasks: [
          validTask,
          { entities: [], metric: { family: "operating_kpi" } }, // no question → structural
          { question: "no metric", entities: [{ ticker: "AAPL", role: "subject" }] }, // no metric
        ],
      },
      ctx,
    );
    expect(out.tasks).toHaveLength(1);
    expect(out.tasksRejectedCount).toBe(2);
    // routing fields untouched
    expect(out.required_data).toEqual(["EARNINGS"]);
    expect(out.tickers).toEqual(["COST"]);
  });

  it("a clean array → tasks present, tasksRejectedCount 0", () => {
    const out = normalizeClassifierResult({ ...base, tasks: [validTask] }, ctx);
    expect(out.tasks).toHaveLength(1);
    expect(out.tasksRejectedCount).toBe(0);
  });

  it("an all-malformed array → no tasks field, but rejectedCount surfaces the count", () => {
    const out = normalizeClassifierResult({ ...base, tasks: [{ junk: true }, { also: "bad" }] }, ctx);
    expect(out.tasks).toBeUndefined();
    expect(out.tasksRejectedCount).toBe(2);
  });

  it("no tasks field at all → neither tasks nor tasksRejectedCount present", () => {
    const out = normalizeClassifierResult({ ...base }, ctx);
    expect(out.tasks).toBeUndefined();
    expect(out.tasksRejectedCount).toBeUndefined();
  });
});
