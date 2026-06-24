// server/agent/taskPlanning/shadow.ts
//
// Phase 1 shadow comparison (task-centric 地基块 #4). Pure + deterministic: given the
// LLM's emitted RawTaskCandidate[] and the SAME turn's live routing tuple, run the
// Phase 2 compiler and diff the derived plan against what routing actually did. This
// is the measurement that answers Phase 3 启动门槛 6 — does the model stably emit a
// minimal task subset that compiles to the same source plan?
//
// RECORD-ONLY: nothing here feeds execution. It only produces a comparison record.

import { compileTasks } from "./compileTasks";
import type { PlanStatus, RawTaskCandidate } from "./types";

export interface ShadowComparison {
  tasksEmitted: number;
  /** Compiler verdict, or "no_tasks" when the LLM emitted none. */
  plannerStatus: PlanStatus | "no_tasks";
  derivedRequiredData: string[];
  routingRequiredData: string[];
  /** Set-equal (order-insensitive) — the headline agreement signal. */
  requiredDataMatch: boolean;
  /** Sources the task plan would call that routing did not (and vice versa). */
  onlyInTasks: string[];
  onlyInRouting: string[];
  derivedSubjectTickers: string[];
  routingTickers: string[];
  tickersMatch: boolean;
}

const normSet = (xs: string[]): string[] => [...new Set(xs.map((x) => x.toUpperCase()))].sort();
const setEq = (a: string[], b: string[]) => JSON.stringify(normSet(a)) === JSON.stringify(normSet(b));
const minus = (a: string[], b: string[]) => {
  const bs = new Set(normSet(b));
  return normSet(a).filter((x) => !bs.has(x));
};

/**
 * Compare the shadow task plan to the live routing tuple. `tasks` undefined/empty →
 * a "no_tasks" record (the model didn't emit the subset for this turn).
 */
export function compareToRouting(
  tasks: RawTaskCandidate[] | undefined,
  routing: { required_data: string[]; tickers: string[] },
): ShadowComparison {
  const routingRequiredData = normSet(routing.required_data ?? []);
  const routingTickers = normSet(routing.tickers ?? []);

  if (!tasks || tasks.length === 0) {
    return {
      tasksEmitted: 0,
      plannerStatus: "no_tasks",
      derivedRequiredData: [],
      routingRequiredData,
      requiredDataMatch: false,
      onlyInTasks: [],
      onlyInRouting: routingRequiredData,
      derivedSubjectTickers: [],
      routingTickers,
      tickersMatch: false,
    };
  }

  const plan = compileTasks(tasks);
  const derivedRequiredData = normSet(plan.requiredData);
  const derivedSubjectTickers = normSet(plan.subjectTickers);

  return {
    tasksEmitted: tasks.length,
    plannerStatus: plan.status,
    derivedRequiredData,
    routingRequiredData,
    requiredDataMatch: setEq(plan.requiredData, routing.required_data ?? []),
    onlyInTasks: minus(plan.requiredData, routing.required_data ?? []),
    onlyInRouting: minus(routing.required_data ?? [], plan.requiredData),
    derivedSubjectTickers,
    routingTickers,
    tickersMatch: setEq(plan.subjectTickers, routing.tickers ?? []),
  };
}
