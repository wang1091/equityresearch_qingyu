// server/agent/classifier/types.ts
// Shared types for the intent classifier (see ./index.ts).

import type { RawTaskCandidate } from "../taskPlanning/types";

export interface ClassificationResult {
  success: true;
  query: string;
  required_data: string[];
  primary_focus: string;
  intents: string[];
  tickers: string[];
  need_api: boolean;
  confidence: number;
  reasoning: string;
  api_params: Record<string, any>;
  /**
   * Phase 1 SHADOW (task-centric 地基块 #4): the minimal RawTaskCandidate[] the LLM
   * emits alongside its routing decision. RECORD-ONLY — nothing in the execution path
   * reads this. It exists so we can run it through the Phase 2 compiler and compare
   * the derived plan against the live routing tuple, measuring whether the model
   * stably emits the minimal task subset (Phase 3 启动门槛 6). Additive + reversible;
   * absent on legacy/fallback results. See docs/TASK_CENTRIC_QUERY_PLANNING.md.
   */
  tasks?: RawTaskCandidate[];
  /**
   * Phase 1 SHADOW observability: how many candidates in the LLM's raw `tasks` array
   * were dropped as structurally invalid (present only when the LLM emitted a tasks
   * array). The valid ones land in `tasks`; this count is what makes the rejection
   * rate measurable downstream — without it the shadow script can only re-parse the
   * already-cleaned `tasks` and would always see zero rejects.
   */
  tasksRejectedCount?: number;
  /**
   * True when this result came from the deterministic keyword fallback
   * (buildKeywordFallback) rather than the LLM — i.e. every LLM provider failed.
   * The fallback is structurally single-intent, so a multi-intent query is
   * silently degraded. This flag surfaces that so downstream can log/handle it
   * instead of treating a degraded guess as a clean classification (bug 005).
   */
  degraded?: boolean;
}

export interface ConversationTurn {
  role: string;
  content: string;
}
