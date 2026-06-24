// ResolvedPlan — the single typed "what does this turn want" object
// (PLAN_CONSOLIDATION_PLAN.md Step 1). Today the answer to that question is
// re-derived in 3-4 places: fetchTurnData (isSetScreen → fan-out), the direct-card
// guards (hasComparisonKeywords / isMultipleStocks / isRumorQuery / single-intent),
// and the generate section (deriveAnswerIntent + specialMode). resolvePlan() folds
// the PRE-FETCH parts of those into one pure function so consumers stop each
// re-deriving from raw fields + history + userMessage.
//
// SCOPE (Step 1 = "wrap, don't wire"): resolvePlan is a faithful mirror of the
// existing scattered logic — its output is equivalent to what runs today. It is
// NOT yet read by any consumer; chat()/chatStream() keep their inline logic until
// Step 2 swaps each call-site over. Equivalence is pinned by resolvePlan.test.ts.
//
// PRE-FETCH ONLY (deliberate): resolvePlan runs at the same point classifyTurn
// finishes, BEFORE callApis. So it cannot decide things that depend on the fetched
// payload's shape — the final DIRECT_CARD vs LLM-fallback choice (isSingleEarningsAnswer
// needs apiData.EARNINGS.topic, submodule-failure checks, etc.) stays a post-fetch
// render decision in chatStream. resolvePlan exposes the pre-fetch guards that
// gate it. Likewise `fetch[].params` is POST-fan-out but PRE-localization: lang
// injection + enablePerformanceMetrics are language/runtime concerns the streaming
// wrapper applies, not facts about the plan (keeps resolvePlan pure over its inputs).
//
// Deviations from the §二 sketch, on purpose (the schema grows bottom-up, §三):
//   - answerMode omits DIRECT_CARD (post-fetch; see above) — only the generation
//     modes SIMPLE/BRIEF/NEWS_BRIEF, mirroring index.ts specialMode.
//   - entities carry symbol + role (Step 3): a set-screen frames every ticker as an
//     independent subject (TARGET); otherwise the first is the subject and the rest
//     are comparison peers (PEER). role drives PERFORMANCE fan-out, generalizing —
//     and retiring — the old includePerformance boolean threaded from isSetScreen.
import { deriveAnswerIntent, COMPARISON_RE, type AnswerIntent } from "./answerIntent";
import { fanOutByRole, baseParams, type EntityRole } from "./apiParamsFanout";
import { resolveListOperand, type ListOperand } from "./turnKind";
import { looksLikeInvestmentDecisionQuery } from "../../shared/earnings";
import { compileTasks } from "./taskPlanning/compileTasks";
import type { RawTaskCandidate, TaskExecutionPlan } from "./taskPlanning/types";
import { logger } from "../utils";
import type { LastTurnFrame } from "./conversation";
import type { ListSnapshot } from "@shared/listSnapshot";

/** Generation mode — mirrors index.ts specialMode (NEWS_BRIEF > BRIEF > SIMPLE). */
export type AnswerMode = "SIMPLE" | "BRIEF" | "NEWS_BRIEF";

/** Pre-fetch deterministic signals that gate routing / render decisions. */
export interface PlanGuards {
  /** Screen over the prior result set → PERFORMANCE may fan out (turnKind.resolveListOperand). */
  isSetScreen: boolean;
  /** Explicit comparison wording (COMPARISON_RE === index.ts hasComparisonKeywords). */
  isComparison: boolean;
  /** 2+ tickers in scope (index.ts isMultipleStocks). */
  isMultiTicker: boolean;
  /** Exactly one required_data source (the direct-card single-intent gate). */
  isSingleIntent: boolean;
  /** Single RUMOR intent (index.ts isRumorQuery — bypasses the multi-ticker guard). */
  isRumorOnly: boolean;
}

/**
 * A planned fetch. `source`/`params` are the source-centric execution inputs every
 * consumer (fetchTurnData → callApis) already reads. The optional task-centric fields
 * are ADDITIVE provenance attached only on the task-centric path (Phase 3): they make
 * the fetch taskId-addressable without changing what executes. Legacy/fallback plans
 * emit just `{ source, params }`.
 */
export interface PlanFetchStep {
  source: string;
  params: any;
  /** Stable FetchStep id (`task-N#k`) — present on the task-centric path. */
  id?: string;
  /** The QueryTask this fetch serves — the Phase 4/5 result-attribution seam. */
  taskId?: string;
  /** Capability priority (higher = preferred); lower entries are runtime fallbacks. */
  priority?: number;
  /** Set when this step is a runtime fallback for another step (same taskId). */
  fallbackOf?: string;
}

export interface ResolvedPlan {
  // ① 回答形态
  answerMode: AnswerMode;
  answerIntent: AnswerIntent;
  // ② 实体 + role（TARGET=逐只扇出 / PEER=比较锚点折进单次 peer 调用）
  entities: { symbol: string; role: EntityRole }[];
  // ③ 取数计划（need_api 闸门 + fan-out；params 为 post-fanOut / pre-localize）
  needApi: boolean;
  fetch: PlanFetchStep[];
  // ④ guards（TS 确定性 pre-fetch 信号）
  guards: PlanGuards;
  // ⑤ 列表操作数解析结果（turn_kind 4b）。承载决策 provenance（kind+reason），供 commit 单点
  //    的「轮决策 trace」一行读出 set-screen 为何触发/未触发。可选：旧测试构造的 plan 字面量无此字段。
  operand?: ListOperand;
  // ⑥ task-centric 计划（Phase 3）。LLM 吐出 tasks 时附上编译结果（QueryTask[]/FetchStep[]/status），
  //    作为 provenance + shadow + Phase 4/5 的接入点。仅当本轮 emit 了 tasks 时存在。`taskFetchActive`
  //    = 上面 fetch[] 是否由 task 计划驱动（仅在 task 计划与 legacy 计划【可证等价】时为 true，见
  //    deriveTaskFetch）；false ⇒ fetch 仍是 legacy 派生、task 计划只作影子记录。
  taskPlan?: TaskExecutionPlan;
  taskFetchActive?: boolean;
}

type Classification = Record<string, any>;
type HistoryMsg = { role: string; content: string };

/**
 * Resolve a normalized classification into a typed plan. The set-screen signal comes from
 * the structured prior-turn `activeList` (turn_kind Phase 4b-0); `history` is the reload
 * fallback (the persisted projection line stands in for a dropped activeList — see
 * resolveListOperand).
 */
export function resolvePlan(
  classification: Classification,
  history: HistoryMsg[],
  userMessage: string,
  activeList?: ListSnapshot,
): ResolvedPlan {
  const requiredData: string[] = Array.isArray(classification.required_data)
    ? classification.required_data
    : [];
  const tickers: string[] = Array.isArray(classification.tickers)
    ? classification.tickers
    : [];
  // Gate mirrors fetchTurnData: `need_api && required_data.length > 0`.
  const needApi = !!classification.need_api && requiredData.length > 0;

  const operand = resolveListOperand(userMessage, classification, activeList, history);
  const setScreen = operand.kind === "screen";

  // ② entities + role. set-screen → every ticker is an independent TARGET; otherwise
  // the first ticker is the TARGET (subject) and the rest are comparison PEERs —
  // matching PERFORMANCE's primary+peers single-call semantic. This is the exact
  // generalization of the old includePerformance flag: PERFORMANCE fans iff #TARGET≥2,
  // which equals isSetScreen (screen → all TARGET → ≥2; comparison → 1 TARGET).
  // On a set-screen the operand carries the MATERIALIZED member set (the exact list the
  // user saw — turnKind #5), which may differ from the classifier's re-emit; fan that set.
  // Off a screen the operand has no tickers, so the classifier set drives as before.
  const fanTickers = operand.kind === "screen" ? operand.tickers : tickers;
  const entities = fanTickers.map((symbol, i) => ({
    symbol,
    role: (setScreen || i === 0 ? "TARGET" : "PEER") as EntityRole,
  }));

  // ③ Deterministic, role-driven fan-out (pre-localize; buildLocalizedApiParams runs
  // later in the wrapper). PERFORMANCE fans its TARGETs; VALUATION/RATING/STOCK_PRICE
  // fan all entities; everything else passes through.
  const fannedApiParams =
    fanOutByRole(classification.api_params, entities, requiredData) ?? {};
  const legacyFetch: PlanFetchStep[] = needApi
    ? requiredData.map((source) => ({ source, params: fannedApiParams[source] }))
    : [];

  // ③' Task-centric path (Phase 3, the §七 strangler). When the classifier emitted a
  // minimal task subset, compile it (CapabilityRegistry → FetchStep[]) and — ONLY when
  // the task plan is provably equivalent to the legacy source plan (deriveTaskFetch) —
  // execute the taskId-addressable steps instead. Any divergence keeps legacy fetch and
  // records the task plan as shadow provenance. Equivalence is by construction, so the
  // chat/chatStream + direct-card regression面 cannot move (doc §10.6).
  const tasks = classification.tasks as RawTaskCandidate[] | undefined;
  const taskPlan =
    Array.isArray(tasks) && tasks.length > 0 ? compileTasks(tasks) : undefined;
  // Pass the ACTUALLY-fanned set (fanTickers) as legacyTickers, NOT classification.tickers:
  // a materialized screen (10) vs a classifier-sourced task plan (3) must diverge here so
  // the gate refuses cutover — otherwise it would attach a "≡ 3-ticker task" provenance to
  // a 10-ticker fetch (a false equivalence). See deriveTaskFetch.
  const taskFetch = needApi && taskPlan
    ? deriveTaskFetch(taskPlan, legacyFetch, fannedApiParams, requiredData, fanTickers)
    : undefined;
  const fetch = taskFetch ?? legacyFetch;

  // ④ Pre-fetch guards (replace the inline re-derivation in chat/chatStream).
  const guards: PlanGuards = {
    isSetScreen: setScreen,
    isComparison: COMPARISON_RE.test(userMessage),
    isMultiTicker: tickers.length > 1,
    isSingleIntent: requiredData.length === 1,
    isRumorOnly: requiredData.length === 1 && requiredData[0] === "RUMOR",
  };

  // ① Answer shape — mirrors index.ts specialMode precedence.
  let answerMode: AnswerMode;
  if (classification.primary_focus === "NEWS_BRIEF" && classification.newsContext) {
    answerMode = "NEWS_BRIEF";
  } else if (looksLikeInvestmentDecisionQuery(userMessage)) {
    answerMode = "BRIEF";
  } else {
    answerMode = "SIMPLE";
  }
  const answerIntent = deriveAnswerIntent(userMessage, classification);

  return {
    answerMode,
    answerIntent,
    entities,
    needApi,
    fetch,
    guards,
    operand,
    ...(taskPlan ? { taskPlan, taskFetchActive: taskFetch !== undefined } : {}),
  };
}

const setEq = (a: string[], b: string[]): boolean => {
  const na = [...new Set(a.map((x) => x.toUpperCase()))].sort();
  const nb = [...new Set(b.map((x) => x.toUpperCase()))].sort();
  return na.length === nb.length && na.every((x, i) => x === nb[i]);
};

const normalizeSemanticText = (value: string): string =>
  value
    .toLowerCase()
    .replace(/['’]s\b/g, "")
    .replace(/\b(?:what|which|who|when|where|why|how|is|are|was|were|do|does|did|the|a|an|of|for|please|show|me|tell)\b/g, " ")
    .replace(/[^\p{L}\p{N}]+/gu, "");

const legacySemanticTexts = (params: unknown): string[] => {
  const entries = Array.isArray(params) ? params : [params];
  return entries.flatMap((entry) => {
    if (!entry || typeof entry !== "object") return [];
    const { query, question } = entry as { query?: unknown; question?: unknown };
    return [query, question]
      .filter((value): value is string => typeof value === "string")
      .map(normalizeSemanticText)
      .filter(Boolean);
  });
};

/**
 * A source/ticker match is not enough to attach task provenance: two different
 * metrics can use the same provider, and multiple tasks can collapse to one legacy
 * source call. Until the provider adapter can project arbitrary task semantics, only
 * cut over the simple lookup subset whose scoped legacy text proves the same question.
 */
function hasEquivalentTaskProvenance(
  taskPlan: TaskExecutionPlan,
  legacyFetch: PlanFetchStep[],
): boolean {
  const primarySteps = taskPlan.fetch.filter((step) => !step.fallbackOf);
  if (primarySteps.length !== taskPlan.tasks.length) return false;

  const uniqueSources = [...new Set(legacyFetch.map((fetch) => fetch.source))];
  return uniqueSources.every((source) => {
    const owners = primarySteps.filter((step) => step.source === source);
    if (owners.length !== 1) return false;

    const task = taskPlan.tasks.find((candidate) => candidate.id === owners[0].taskId);
    if (
      !task ||
      task.operation !== "lookup" ||
      task.period ||
      task.evidenceConstraints?.length ||
      task.evidenceRelation ||
      !task.metric?.name
    ) {
      return false;
    }

    const legacyParams = legacyFetch.find((fetch) => fetch.source === source)?.params;
    const texts = legacySemanticTexts(legacyParams);
    const question = normalizeSemanticText(task.question);
    const metric = normalizeSemanticText(task.metric.name);
    return texts.some((text) => text === question && text.includes(metric));
  });
}

/**
 * Decide whether the compiled task plan may DRIVE this turn's fetch (the Phase 3
 * cutover gate). We switch only when the task plan is **provably equivalent** to the
 * legacy source plan — same status-ready intent, source set, subject tickers, and a
 * one-to-one semantic match between each simple lookup task and its scoped legacy
 * query. The only observable change is then the ADDITIVE taskId/priority/fallbackOf
 * carried on each fetch entry; sources and params are byte-identical to legacy.
 * Provider params are reused from the legacy fan-out (Phase 3 = legacy projection,
 * doc §10.5 step 4; the logical→provider adapter is Phase 4).
 *
 * Returns the taskId-addressable FetchStep[] on cutover, or `undefined` to keep legacy
 * fetch. Divergence (conflict→clarification_required, unsupported, under-decomposition
 * dropping a source, or a different ticker set) intentionally falls back to legacy and
 * is logged — the task plan still rides along as `plan.taskPlan` provenance. This is
 * the "先派生 + shadow 对比，再切" discipline: never let the two plans drift in prod.
 */
function deriveTaskFetch(
  taskPlan: TaskExecutionPlan,
  legacyFetch: PlanFetchStep[],
  fannedApiParams: Record<string, any>,
  legacyRequiredData: string[],
  legacyTickers: string[],
): PlanFetchStep[] | undefined {
  const legacySources = legacyFetch.map((f) => f.source);
  const equivalent =
    taskPlan.status === "ready" &&
    setEq(taskPlan.requiredData, legacyRequiredData) &&
    setEq(taskPlan.subjectTickers, legacyTickers) &&
    hasEquivalentTaskProvenance(taskPlan, legacyFetch);

  if (!equivalent) {
    logger.info(
      `🧩 task-plan shadow (no cutover): status=${taskPlan.status} ` +
        `taskSources=[${taskPlan.requiredData.join(",")}] legacySources=[${legacySources.join(",")}] ` +
        `taskTickers=[${taskPlan.subjectTickers.join(",")}] legacyTickers=[${legacyTickers.join(",")}]`,
    );
    return undefined;
  }

  // Equivalent: re-emit the legacy per-source fetch, attaching the task provenance.
  // PRIMARY (non-fallback) steps only drive execution — runtime fallback is Phase 4
  // (§8.2). Multiple tasks may share a source; callApis is still source-centric, so we
  // keep one fetch entry per source (params are identical regardless of task) and tag it
  // with the first owning task — the per-task result split is the Phase 4/5 seam (§10.4).
  const primaryBySource = new Map<string, { id: string; taskId: string; priority: number }>();
  for (const step of taskPlan.fetch) {
    if (step.fallbackOf) continue;
    if (!primaryBySource.has(step.source)) {
      primaryBySource.set(step.source, { id: step.id, taskId: step.taskId, priority: step.priority });
    }
  }

  return legacyFetch.map((f) => {
    const provenance = primaryBySource.get(f.source);
    return provenance
      ? { source: f.source, params: fannedApiParams[f.source], ...provenance }
      : f;
  });
}

/**
 * CORRECT patch (turn_kind Phase 3). A correction ("我说的是阿里不是百度") must re-run the
 * PRIOR turn's intent with only the entity swapped — not re-route as a FRESH query. The
 * classifier has already resolved the corrected NAME→ticker; here we inherit the prior
 * turn's lens (required_data / primary_focus / answerIntent) from the lastTurn frame and
 * rebase its api_params onto the corrected entity. Returns the patched plan + a coherent
 * classification view (so back-half metadata / onPayload aren't stale), or null when no
 * corrected entity is resolvable → caller falls back to FRESH (design §4.3.5).
 */
export function patchCorrectedPlan(
  classification: Classification,
  lastTurn: LastTurnFrame,
): { plan: ResolvedPlan; classification: Classification } | null {
  const classified: string[] = (Array.isArray(classification.tickers) ? classification.tickers : [])
    .map((t: unknown) => String(t).toUpperCase().trim())
    .filter(Boolean);
  if (classified.length === 0) return null;

  // The corrected (RIGHT) entity is the classified ticker NOT already in the prior set —
  // leverages the classifier's NAME→ticker resolution (a regex can't map 阿里→BABA). If the
  // subtraction is empty (classifier returned only the corrected one), use classified as-is.
  const priorSet = lastTurn.resultTickers.map((t) => t.toUpperCase());
  const subtracted = classified.filter((t) => !priorSet.includes(t));
  const finalTickers = subtracted.length > 0 ? subtracted : classified;
  if (finalTickers.length === 0) return null;

  const requiredData = lastTurn.classification.required_data ?? [];
  const answerIntent = lastTurn.answerIntent; // inherit the prior lens
  // answerIntent==="decision" ⟺ the prior turn was a BRIEF (looksLikeInvestmentDecisionQuery);
  // NEWS_BRIEF needs newsContext a correction never carries → SIMPLE otherwise.
  const answerMode: AnswerMode = answerIntent === "decision" ? "BRIEF" : "SIMPLE";
  const entities = finalTickers.map((symbol, i) => ({
    symbol,
    role: (i === 0 ? "TARGET" : "PEER") as EntityRole,
  }));
  const needApi = !!lastTurn.classification.need_api && requiredData.length > 0;
  const rebased = rebaseApiParams(lastTurn.classification.api_params ?? {}, requiredData, entities, finalTickers);
  const fetch = needApi ? requiredData.map((source) => ({ source, params: rebased[source] })) : [];

  const plan: ResolvedPlan = {
    answerMode,
    answerIntent,
    entities,
    needApi,
    fetch,
    guards: {
      isSetScreen: false,
      isComparison: false,
      isMultiTicker: finalTickers.length > 1,
      isSingleIntent: requiredData.length === 1,
      isRumorOnly: requiredData.length === 1 && requiredData[0] === "RUMOR",
    },
    operand: { kind: "none", reason: "no_anaphor" }, // a correction re-runs a single entity, never a screen
  };
  const patchedClassification: Classification = {
    ...classification,
    tickers: finalTickers,
    required_data: requiredData,
    primary_focus: lastTurn.classification.primary_focus,
    need_api: needApi,
  };
  return { plan, classification: patchedClassification };
}

/** Rebase the prior turn's api_params onto the corrected entity(ies), keeping query/lang. */
function rebaseApiParams(
  priorParams: Record<string, any>,
  requiredData: string[],
  entities: { symbol: string; role: EntityRole }[],
  tickers: string[],
): Record<string, any> {
  // ≥2 corrected tickers: fanOutByRole shapes the per-ticker sources off the prior base.
  const out: Record<string, any> = { ...(fanOutByRole(priorParams, entities, requiredData) ?? {}) };
  for (const source of requiredData) {
    if (Array.isArray(out[source])) continue; // already fanned (≥2)
    const base = baseParams(out[source]);
    out[source] =
      tickers.length === 1
        ? { ...base, ticker: tickers[0], tickers } // both forms — services read one or the other
        : { ...base, tickers };
  }
  return out;
}
