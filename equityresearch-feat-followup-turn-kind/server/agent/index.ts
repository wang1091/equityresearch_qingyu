// Agent主流程协调器
import { logger } from "../utils";
import { classifyIntents } from "./classifier";
import { callApis } from "./apiCaller";
import {
  needsTranslationForLanguage,
  translateTextToLanguage,
} from "../translation";
import { generateAnswerStream, generateUnifiedAnswer, type UnifiedAnswer } from "./generator";
import { projectListTurnToHistory } from "./historyProjection";
import { projectSourceCard } from "@shared/sourceCard";
import { resolvePlan, patchCorrectedPlan, type ResolvedPlan } from "./resolvePlan";
import { detectTranslateCommand, detectCorrection, detectChitchat, answerChitchat, detectRecall, answerRecall, SET_ANAPHOR_RE } from "./turnKind";
import { buildValidData } from "./simplify";
import { buildSources } from "./provenance";
import { resolveRenderPlan } from "./resolveRenderPlan";
import { formatDataAsCard } from "./cardFormatter";
import { normalizeNewsResponse, type NormalizedNewsResponse } from "./newsResponseAdapter";
import type { CompetitiveAnalysisSuccessResponse } from "../competitive/types/wire";
import type { StockPickerCardPayload } from "../../shared/stockPicker";
import {
  addMessage,
  getRecentMessages,
  getConversationLanguage,
  setConversationLanguage,
  commitAssistantTurn,
  answerTurnTransition,
  getLastTurn,
  type Message,
  type LastTurnFrame,
  type LastAnswerSnapshot,
  type StateTransition,
  type ActiveListState,
} from "./conversation";
import { extractListSnapshot, hasRoutableView, capToVisible, type ListSnapshot } from "@shared/listSnapshot";
import { EARNINGS_CALENDAR_USER_QUERY_HINT_KEY } from "../../shared/earnings";
import { coerceMarketEarningsCalendar } from "../earnings/routing";
import {
  EXPLICIT_LIST_PIVOT_RE,
  answerMomentumChoice,
  buildSetChoiceClassification,
  resolveSetChoiceAction,
} from "./listChoice";
import { resolveDrill } from "./drill";
import { resolveComputed } from "./computed";
import { activeListClaimState, primaryClaim, resolveClaimEvidence, snapshotClaimState, type ClaimState } from "./claim";
import { answerJustify, detectJustify } from "./justify";

export type AgentStreamPayload =
  | { type: "news_v2"; payload: NormalizedNewsResponse }
  // COMPETITIVE + STOCK_PICKER folded onto the generic `source_card` event (the
  // frontend registry renders by source). See CARD_RENDER_MIGRATION_PLAN.md §8.
  // Generic structured card: { source, payload }. The frontend renderer registry
  // (features/chat/renderers) renders per source. Migration target replacing the
  // backend HTML formatters (see docs/CARD_RENDER_MIGRATION_PLAN.md).
  | { type: "source_card"; source: string; payload: unknown }
  // Unified fused answer (markdown body + verdict + sources/cards sidecar).
  // Flag-gated (UNIFIED_ANSWER=true); merges the SIMPLE + Investment Brief paths.
  | { type: "unified_answer"; payload: UnifiedAnswer }
  // Precomputed classifier-history line for an HTML direct card (TRENDING /
  // MARKET_DATA / STOCK_PICKER). Rides alongside the streamed card HTML so the
  // client can persist it; on reload the classifier projects this exact line
  // instead of the un-routable card markup (live === reload). See
  // docs/UNIFIED_TURN_HISTORY_PLAN.md.
  | { type: "history_projection"; source: string; text: string }
  // Final classification tuple, emitted once before data fetch. The frontend no
  // longer calls /classify-intents-multi itself — it populates intentInfo (News
  // Brief CTA, ticker context) from this event.
  | {
      type: "classification";
      required_data: string[];
      intents: string[];
      tickers: string[];
      primary_focus: string;
      reasoning: string;
      confidence: number;
    };

interface AgentResponse {
  success: boolean;
  answer: string;
  conversationId: string;
  metadata?: {
    requiredData: string[];
    tickers: string[];
    apiCallCount: number;
    totalTime: number;
    skipDeepseek?: boolean;  // ✅ 新增：是否跳过 LLM
    directCard?: boolean;    // ✅ 新增：是否使用直接卡片
    competitiveProvider?: string;  // COMPETITIVE 实现来源 (flask-gpt4o / node-deepseek)，透传自子模块 _meta.provider
    degraded?: boolean;      // 分类来自关键词兜底（LLM 全部失败）→ 多意图可能丢失 (bug 005)
  };
  error?: string;
}

/** A synthesized claim for a NARRATIVE data-answer turn (DRILL / plain LLM answer), so a later
 *  "why" reaches JUSTIFY with the turn's provenance. `claimable` must be true ONLY for an
 *  actual synthesized answer — direct cards (board / news / source_card) skip the LLM and have
 *  no conclusion, so they pass false and the claim is cleared (a "why" then falls through, not
 *  mislabeled as narrative analysis). Shared by chat() and chatStream() so they stay
 *  equivalent. Returns undefined ⇒ answerTurnTransition clears the claim. */
function answerClaimTransition(
  snapshot: LastAnswerSnapshot | undefined,
  frame: LastTurnFrame,
  claimable: boolean,
): StateTransition<ClaimState> | undefined {
  return claimable && snapshot?.sources?.length
    ? { replace: snapshotClaimState(snapshot, frame.resultTickers) }
    : undefined;
}

function applyParamOverride(
  params: any,
  overrides: Record<string, any>
): any {
  if (!params) return params;
  if (Array.isArray(params)) {
    return params.map((item) => ({
      ...item,
      ...overrides,
    }));
  }
  return {
    ...params,
    ...overrides,
  };
}

function buildLocalizedApiParams(
  rawApiParams: Record<string, any> | undefined,
  conversationLanguage: "en" | "zh",
  options?: { enablePerformanceMetrics?: boolean; rumorQuery?: string }
): Record<string, any> {
  const apiParams = rawApiParams ? { ...rawApiParams } : {};

  if (options?.enablePerformanceMetrics && apiParams["PERFORMANCE"]) {
    apiParams["PERFORMANCE"] = applyParamOverride(apiParams["PERFORMANCE"], {
      fetchMetrics: true,
    });
    logger.info("📊 单意图 PERFORMANCE，注入 fetchMetrics: true");
  }

  if (apiParams["EARNINGS"]) {
    apiParams["EARNINGS"] = applyParamOverride(apiParams["EARNINGS"], {
      lang: conversationLanguage,
    });
  }

  if (apiParams["NEWS"]) {
    apiParams["NEWS"] = applyParamOverride(apiParams["NEWS"], {
      responseLanguage: conversationLanguage,
      lang: conversationLanguage,
      language: "en",
    });
  }

  if (apiParams["PERFORMANCE"]) {
    apiParams["PERFORMANCE"] = applyParamOverride(apiParams["PERFORMANCE"], {
      lang: conversationLanguage,
    });
  }

  if (apiParams["COMPETITIVE"]) {
    apiParams["COMPETITIVE"] = applyParamOverride(apiParams["COMPETITIVE"], {
      lang: conversationLanguage,
    });
  }

  if (apiParams["RUMOR"]) {
    apiParams["RUMOR"] = applyParamOverride(apiParams["RUMOR"], {
      language: conversationLanguage,
      ...(options?.rumorQuery ? { query: options.rumorQuery } : {}),
    });
  }

  return apiParams;
}

/** Lets apiCaller calendar-route when context.userMessage is missing in some runtimes */
function attachEarningsCalendarUserQueryHint(
  apiParams: Record<string, any>,
  userMessage: string,
): void {
  const earnings = apiParams["EARNINGS"];
  if (!earnings || typeof earnings !== "object") return;
  if (Array.isArray(earnings)) {
    for (const item of earnings) {
      if (item && typeof item === "object" && !Array.isArray(item)) {
        item[EARNINGS_CALENDAR_USER_QUERY_HINT_KEY] = userMessage;
      }
    }
    return;
  }
  earnings[EARNINGS_CALENDAR_USER_QUERY_HINT_KEY] = userMessage;
}

/** Align snake_case / camelCase classification payloads from different clients. */
function normalizeClassificationPayload(raw: unknown): Record<string, any> {
  const c = raw && typeof raw === "object" ? (raw as Record<string, any>) : {};
  const required = Array.isArray(c.required_data)
    ? c.required_data
    : Array.isArray(c.requiredData)
      ? c.requiredData
      : Array.isArray(c.intents)
        ? c.intents
        : [];
  const api =
    c.api_params && typeof c.api_params === "object"
      ? { ...c.api_params }
      : c.apiParams && typeof c.apiParams === "object"
        ? { ...c.apiParams }
        : {};
  const tickers = Array.isArray(c.tickers) ? c.tickers : [];
  const needApi =
    typeof c.need_api === "boolean"
      ? c.need_api
      : typeof c.needApi === "boolean"
        ? c.needApi
        : true;
  const primary =
    typeof c.primary_focus === "string"
      ? c.primary_focus
      : typeof c.primaryFocus === "string"
        ? c.primaryFocus
        : (required[0] as string) || "GENERAL";
  return {
    ...c,
    required_data: required.filter((x: unknown) => typeof x === "string") as string[],
    api_params: api,
    tickers,
    need_api: needApi !== false,
    primary_focus: primary,
  };
}


function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&#039;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

function normalizeText(text: string): string {
  return text
    .replace(/\s+/g, " ")
    .replace(/[?!.]+$/g, "")
    .trim()
    .toLowerCase();
}

function stripEchoedUserQuestion(cardHtml: string, userMessage: string): string {
  const questionBlockRegex =
    /<div style="margin-bottom: 12px; padding: 10px 12px; background: #f8fafc; border-radius: 8px; border: 1px solid #e5e7eb;">\s*<div style="font-size: 12px; font-weight: 700; color: #64748b; margin-bottom: 6px;">(?:Question|问题)<\/div>\s*<div style="font-size: 14px; color: #0f172a; line-height: 1\.6;">([\s\S]*?)<\/div>\s*<\/div>/;

  const match = cardHtml.match(questionBlockRegex);
  if (!match) {
    return cardHtml;
  }

  const echoedQuestion = decodeHtmlEntities(match[1].replace(/<br\s*\/?>/gi, " "));
  if (normalizeText(echoedQuestion) !== normalizeText(userMessage)) {
    return cardHtml;
  }

  return cardHtml.replace(questionBlockRegex, "");
}

async function localizeGeneratedHtml(
  html: string,
  language: "en" | "zh",
): Promise<string> {
  const visibleText = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&[a-zA-Z0-9#]+;/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!needsTranslationForLanguage(visibleText, language)) {
    return html;
  }

  logger.info(`🌐 翻译直接卡片 HTML 到 ${language}`);
  return translateTextToLanguage(html, language, "html");
}

// ============================================================================
// Shared turn front-half (PLAN_CONSOLIDATION_PLAN.md Step 0 + 2)
//
// chat() (non-streaming twin) and chatStream() (streaming) ran two near-identical
// copies of "classify → params → fetch". That duplication is the documented
// source of the (c)-class wiring bug: logic (fan-out / isSetScreen) added to one
// twin and missed in the other. classifyTurn() owns classify→normalize→coerce;
// resolvePlan() (resolvePlan.ts) now owns the routing/fan-out/answer-shape decisions
// (Step 2 moved them off the wrappers); fetchTurnData() just executes plan.fetch
// (localize + callApis). The divergent back-half (chat = SIMPLE/Brief via
// generateAnswerStream; chatStream = direct-card / unified-answer) stays per-wrapper
// — chat.e2e pins chat() to the simpler generateAnswerStream path, so generation is
// intentionally NOT unified here. Both wrappers now read one ResolvedPlan.
// ============================================================================

/**
 * Classify the turn and normalize the payload. history already includes the
 * current userMessage (addMessage ran first) — slice its tail off so the
 * classifier doesn't see the user echo and mis-anchor reference resolution
 * (the current turn is re-injected separately downstream).
 */
async function classifyTurn(
  userMessage: string,
  history: Message[],
  conversationLanguage: "en" | "zh",
): Promise<Record<string, any>> {
  logger.info("📋 [1/3] 分析需求");
  const raw = await classifyIntent(
    userMessage,
    history.slice(0, -1),
    conversationLanguage,
  );
  const classification = normalizeClassificationPayload(raw);
  coerceMarketEarningsCalendar(classification, userMessage);
  if (classification.degraded) {
    logger.warn(
      "⚠️ 分类降级：LLM 全部失败，已用关键词兜底（单意图）—— 多意图查询的次要意图可能丢失 (bug 005)",
    );
  }
  logger.info(`  → 数据源: ${classification.required_data.join(", ") || "无"}`);
  return classification;
}

/**
 * Execute the plan's fetch step: gate on plan.needApi → reassemble plan.fetch
 * (already fanned-out + isSetScreen-resolved by resolvePlan, pre-localize) into the
 * per-source object → localize (language) + runtime overrides → calendar hint →
 * callApis. Returns null when the turn needs no API. The fan-out / isSetScreen
 * wiring now lives solely in resolvePlan; this just applies the language/runtime
 * layer that the plan deliberately leaves out (so resolvePlan stays pure).
 */
async function fetchTurnData(
  plan: ResolvedPlan,
  userMessage: string,
  conversationLanguage: "en" | "zh",
  options?: {
    onToolCall?: (info: {
      dataSource: string;
      status: "start" | "success" | "error";
      data?: any;
      error?: string;
      duration?: number;
    }) => void;
    enablePerformanceMetrics?: boolean;
  },
): Promise<Record<string, any> | null> {
  if (!plan.needApi) {
    logger.info("⚡ [2/3] 跳过API（使用知识库）");
    return null;
  }
  logger.info("📊 [2/3] 获取数据");
  const fannedApiParams: Record<string, any> = {};
  for (const { source, params } of plan.fetch) fannedApiParams[source] = params;
  const apiParams = buildLocalizedApiParams(fannedApiParams, conversationLanguage, {
    enablePerformanceMetrics: options?.enablePerformanceMetrics,
    rumorQuery: userMessage,
  });
  attachEarningsCalendarUserQueryHint(apiParams, userMessage);
  return callApis(
    plan.fetch.map((f) => f.source),
    apiParams,
    options?.onToolCall,
    { userMessage },
  );
}

/**
 * Outcome of the shared turn front-half. `transform` = the translate short-circuit
 * fired (the core already translated + persisted the assistant turn); the wrapper
 * only needs to emit/return. `answer` = the normal path, carrying the classification,
 * resolved plan, and the (history, language) the divergent back-half consumes.
 */
type PreparedTurn =
  | { kind: "transform"; answer: string }
  | {
      kind: "answer";
      classification: Record<string, any>;
      plan: ResolvedPlan;
      history: Message[];
      conversationLanguage: "en" | "zh";
      /** Frame draft for this answer turn — committed (with the snapshot) only after
       *  the answer succeeds, via commitAssistantTurn. */
      frame: LastTurnFrame;
      /** Deterministic set-choice rewrites (e.g. "top two" → an explicit comparison)
       *  use this for fetch/generation while preserving the user's original history text. */
      resolvedUserMessage?: string;
    };

/**
 * Decide the activeList transition for an answer turn (turn_kind 4b). `replace` when this
 * turn rendered a new operable list; otherwise `preserve` when it's a confirmed set-screen
 * OR merely REFERENCES the prior set (set-anaphor + a prior activeList exists) — the latter
 * keeps the parent list alive across a transient classifier miss (a follow-up that should
 * have screened but the classifier under-emitted tickers) instead of dropping it; `clear`
 * otherwise (a fresh entity/topic). This is the PRESERVE decision only — which tickers to
 * materialize / whether to fetch stays the classifier-driven path until 4b-1. getLastTurn
 * here reads the PRIOR turn (commit hasn't run yet).
 */
function activeListTransitionFor(
  conversationId: string,
  userMessage: string,
  plan: ResolvedPlan,
  renderedList: ActiveListState | undefined,
): { transition: StateTransition<ActiveListState>; reason: string } {
  if (renderedList) return { transition: { replace: renderedList }, reason: "rendered_list" };
  const priorActiveList = getLastTurn(conversationId)?.activeList;
  if (!priorActiveList) return { transition: "clear", reason: "no_prior" };
  if (plan.guards.isSetScreen) return { transition: "preserve", reason: "set_screen" };
  if (SET_ANAPHOR_RE.test(userMessage)) return { transition: "preserve", reason: "referenced" };

  const members = new Set(
    priorActiveList.list.views.flatMap((view) =>
      view.items.map((item) => item.ticker?.toUpperCase()).filter(Boolean) as string[],
    ),
  );
  const entities = plan.entities
    .map((entity) => entity.symbol.toUpperCase().trim())
    .filter(Boolean);
  if (entities.length > 0) {
    return entities.every((ticker) => members.has(ticker))
      ? { transition: "preserve", reason: "member_reference" }
      : { transition: "clear", reason: "entity_pivot" };
  }
  if (EXPLICIT_LIST_PIVOT_RE.test(userMessage)) {
    return { transition: "clear", reason: "explicit_pivot" };
  }
  // Unknown relationship is fail-open: retaining a dormant list is reversible; deleting
  // the only structured parent set is not. This does NOT authorize using it this turn.
  return { transition: "preserve", reason: "uncertain_keep" };
}

/** One correlated info line per answer turn — the turn-decision trace (cause → effect) at
 *  the single commit seam, so a state bug ("榜莫名没了" / "其中… 没反应") is reverse-engineerable
 *  from logs alone (the only forensic entry point for in-process frame state). Read AFTER
 *  commit so it shows the resulting frame. See docs/TURN_KIND_PHASE_4B_PLAN.md §六.可观测性. */
function logTurnDecision(
  conversationId: string,
  entry: "chat" | "stream",
  plan: ResolvedPlan,
  activeListTransition: StateTransition<ActiveListState>,
  transitionReason: string,
): void {
  const trLabel =
    activeListTransition === "preserve" || activeListTransition === "clear" ? activeListTransition : "replace";
  logCommittedTurnState(
    conversationId,
    entry,
    `operand=${plan.operand?.kind ?? "?"}(${plan.operand?.reason ?? "?"}${
      plan.operand?.kind === "screen" ? `,${plan.operand.sourced}` : ""
    }) setScreen=${plan.guards.isSetScreen}`,
    trLabel,
    transitionReason,
  );
}

/** The state portion shared by normal answer turns and committed set-choice short exits. */
function logCommittedTurnState(
  conversationId: string,
  entry: "chat" | "stream",
  decision: string,
  activeListTransition: "preserve" | "clear" | "replace",
  transitionReason: string,
  detail = "",
): void {
  const f = getLastTurn(conversationId);
  logger.info(
    `🧭 turn-decision conv=${conversationId} entry=${entry} ` +
      `${decision} activeList=${activeListTransition}(${transitionReason}) → next activeList=${f?.activeList ? `${f.activeList.list.views.length}v` : "none"} ` +
      `snapshot=${f?.snapshot ? "yes" : "no"} focus=[${f?.resultTickers.join(",") ?? ""}] ` +
      `pending=${f?.pendingAction ? `${f.pendingAction.kind}:${f.pendingAction.stage}` : "none"}` +
      detail,
  );
}

/** Build the stateful lastTurn frame from a resolved answer turn (turn_kind gate). */
function frameFromTurn(classification: Record<string, any>, plan: ResolvedPlan): LastTurnFrame {
  return {
    classification: {
      required_data: classification.required_data ?? [],
      primary_focus: classification.primary_focus ?? "GENERAL",
      tickers: classification.tickers ?? [],
      api_params: classification.api_params ?? {},
      need_api: classification.need_api !== false,
    },
    answerIntent: plan.answerIntent,
    resultTickers: plan.entities.map((e) => e.symbol),
    source: classification.primary_focus,
  };
}

/**
 * Build the per-turn data snapshot from the fetched apiData (turn_kind Phase 4a).
 * Called once per turn at fetch time so capturedAt + each source's asOf freeze HERE
 * (a later RECALL reads them verbatim, never "as of the follow-up"). Returns undefined
 * when every source failed (validData empties) so an all-failed turn carries no
 * snapshot and the next RECALL gracefully defers.
 */
export function buildSnapshot(apiData: Record<string, any>): LastAnswerSnapshot | undefined {
  const validData = buildValidData(apiData);
  if (Object.keys(validData).length === 0) return undefined;
  return { capturedAt: new Date().toISOString(), validData, sources: buildSources(validData) };
}

/**
 * Shared turn front-half — the single copy of what chat() and chatStream() used to
 * duplicate byte-for-byte (the documented source of the (c)-class wiring bug, where
 * logic added to one twin was missed in the other; the TRANSFORM short-circuit was
 * the latest victim). Runs the turn_kind gate (precedence CORRECT-detect > TRANSFORM >
 * CHITCHAT > RECALL > classify > CORRECT-patch | FRESH), then resolvePlan + returns the
 * stateful lastTurn frame DRAFT (committed post-success by commitAssistantTurn, with the
 * data snapshot). Stops AT resolvePlan: caller-specific IO (onChunk/onPayload/onToolCall,
 * enablePerformanceMetrics) and the divergent back-halves stay in the wrappers.
 * Timeout/AbortController stay wrapper-owned. See docs/PLAN_CONSOLIDATION_PLAN.md Step 0
 * + docs/FOLLOWUP_TURN_GATE_DESIGN.md (turn_kind Phase 3).
 */
async function prepareTurn(
  conversationId: string,
  userMessage: string,
  entry: "chat" | "stream",
): Promise<PreparedTurn> {
  addMessage(conversationId, "user", userMessage);
  const history = getRecentMessages(conversationId, 10);
  const conversationLanguage = getConversationLanguage(conversationId);
  const lastTurn = getLastTurn(conversationId);

  // CORRECT (precedence #1) — detect the correction structure up front so it's never
  // swallowed by the TRANSFORM/CHITCHAT short-circuits, but DEFER the patch to
  // post-classify: the corrected NAME→ticker needs the classifier (a regex can't map
  // 阿里→BABA). Only meaningful with a prior frame (never fires turn 1).
  const isCorrection = !!lastTurn && detectCorrection(userMessage);

  if (!isCorrection) {
    // TRANSFORM 短路：translate 命令在分类前直接走翻译，不进 provider。
    const translateOp = detectTranslateCommand(userMessage, history);
    if (translateOp) {
      logger.info(`🌐 TRANSFORM 短路：翻译命令 (→${translateOp.targetLanguage}, ${translateOp.payloadSource})`);
      const translated = await translateTextToLanguage(
        translateOp.payloadText,
        translateOp.targetLanguage,
        "markdown",
      );
      addMessage(conversationId, "assistant", translated);
      return { kind: "transform", answer: translated };
    }

    // CHITCHAT 短路：套话/能力问答，need_api=false，零 fetch，固定文案。
    const chit = detectChitchat(userMessage);
    if (chit) {
      logger.info(`💬 CHITCHAT 短路：${chit}`);
      const answer = answerChitchat(chit, conversationLanguage);
      addMessage(conversationId, "assistant", answer);
      return { kind: "transform", answer };
    }

    // RECALL 短路（Phase 4a）：上一轮带数据快照 + 命中「来源/出处/新鲜度」询问。读冻结的
    // snapshot.sources，零 classify / 零 fetch。放在 CHITCHAT 之后、纠错块外，故既不抢
    // CORRECT 补丁，又天然排除纠错轮。短路轮不提交新帧（不覆盖可路由的上一轮）。
    if (lastTurn?.snapshot && detectRecall(userMessage)) {
      logger.info("🔎 RECALL 短路：数据来源/出处");
      // A deterministic claim (computed / momentum) carries an explicit evidence handle;
      // resolve it so RECALL reads exactly that claim's frozen provenance — the parent list,
      // not a newer DRILL snapshot that may coexist. Three cases, NO fail-open:
      //   no claim   → plain fetch turn → cite the snapshot as captured;
      //   resolved   → the claim's own validated evidence;
      //   unavailable→ the claim's evidence slot was swapped out → answer honestly with no
      //                sources rather than citing an unrelated snapshot. See ./claim.ts.
      const claim = lastTurn.claimState ? primaryClaim(lastTurn.claimState) : undefined;
      const evidence = claim ? resolveClaimEvidence(claim, lastTurn) : null;
      const recallSnapshot = !evidence
        ? lastTurn.snapshot
        : evidence.kind === "resolved"
          ? { ...lastTurn.snapshot, capturedAt: evidence.capturedAt, sources: evidence.sources }
          : { ...lastTurn.snapshot, sources: [] };
      const answer = answerRecall(recallSnapshot, conversationLanguage);
      addMessage(conversationId, "assistant", answer);
      return { kind: "transform", answer };
    }

    // JUSTIFY 短路（Phase 4b-3）：上一轮有确定性结论（claimState）+ 命中「为什么/凭什么/准吗」。
    // 读冻结的 claim.derivation 复述推导过程，零 classify / 零 fetch、不调 LLM。只消费已落帧的
    // claim + evidence handle，不调 planner、不按 source 猜依据（单向 …→AnswerClaim→JUSTIFY）。
    // 放在 RECALL 之后：RECALL 问「来源」更具体，JUSTIFY 问「为什么」。同为不提交短路出口。
    if (lastTurn?.claimState && detectJustify(userMessage)) {
      logger.info("🔎 JUSTIFY 短路：为什么/依据");
      const answer = answerJustify(lastTurn.claimState, lastTurn, conversationLanguage);
      addMessage(conversationId, "assistant", answer);
      return { kind: "transform", answer };
    }

    // SET_CHOICE (Phase 4b-1): resolve a contextual "which one should I buy?" or the
    // short answer to our prior criterion/scope clarification BEFORE classification.
    // Binding is the authorization boundary: Phase-0 uncertain_keep may retain a list,
    // but only this resolver is allowed to read/materialize it.
    const choice = resolveSetChoiceAction(
      userMessage,
      lastTurn?.activeList?.list,
      lastTurn?.pendingAction?.kind === "set_choice" ? lastTurn.pendingAction : undefined,
      conversationLanguage,
    );
    if (choice.kind === "clarify") {
      commitAssistantTurn(conversationId, {
        message: choice.message,
        transition: {
          lens: "preserve",
          focus: "preserve",
          snapshot: "preserve",
          activeList: "preserve",
          claimState: "preserve",
          pendingAction: { replace: choice.pending },
        },
      });
      logCommittedTurnState(
        conversationId,
        entry,
        `operand=set_choice(clarify_${choice.reason}) setScreen=false`,
        "preserve",
        "set_choice_clarify",
        ` view=${choice.pending.viewId ?? "?"}`,
      );
      return { kind: "transform", answer: choice.message };
    }
    if (choice.kind === "execute") {
      if (choice.criterion === "momentum") {
        const result = answerMomentumChoice(choice.view, choice.candidates, conversationLanguage);
        commitAssistantTurn(conversationId, {
          message: result.answer,
          transition: {
            lens: "preserve",
            focus: result.ticker ? { replace: [result.ticker] } : "clear",
            snapshot: "preserve",
            activeList: "preserve",
            // Evidence = the parent list this momentum verdict was computed over.
            // Derivation comes FROM answerMomentumChoice (the ranker), not reconstructed here,
            // so JUSTIFY's replay can't drift from how momentum actually ranked.
            claimState: result.derivation && lastTurn?.activeList
              ? { replace: activeListClaimState(result.claim, lastTurn.activeList, result.derivation) }
              : "clear",
            pendingAction: "clear",
          },
        });
        logCommittedTurnState(
          conversationId,
          entry,
          "operand=set_choice(compute_momentum) setScreen=false",
          "preserve",
          "set_choice_momentum",
          ` candidates=${choice.candidates.length}`,
        );
        return { kind: "transform", answer: result.answer };
      }

      const classification = buildSetChoiceClassification(
        choice.criterion,
        choice.candidates,
        choice.effectiveQuery,
        conversationLanguage,
      );
      const plan = resolvePlan(classification, history, choice.effectiveQuery, lastTurn?.activeList?.list);
      logger.info(
        `🧭 set-choice conv=${conversationId} decision=execute criterion=${choice.criterion} ` +
        `candidates=${choice.candidates.map((item) => item.ticker).join(",")}`,
      );
      return {
        kind: "answer",
        classification,
        plan,
        history,
        conversationLanguage,
        frame: frameFromTurn(classification, plan),
        resolvedUserMessage: choice.effectiveQuery,
      };
    }

    // computed RECALL (Phase 4b-1): a superlative over the active list ("其中涨最多的" /
    // "which gained the most") answered from the numbers already on screen — ZERO fetch.
    // Runs after set_choice (a "buy" question is not a plain superlative) and before DRILL
    // (an ordinal is DRILL's job, which computed defers). compute moves focus to the winner
    // and preserves the parent list; empty_domain preserves focus but records its conclusion.
    const computed = resolveComputed(
      userMessage,
      lastTurn?.activeList,
      conversationLanguage,
      lastTurn?.pendingAction?.kind === "computed" ? lastTurn.pendingAction : undefined,
    );
    if (computed.kind === "clarify") {
      commitAssistantTurn(conversationId, {
        message: computed.message,
        transition: {
          lens: "preserve",
          focus: "preserve",
          snapshot: "preserve",
          activeList: "preserve",
          claimState: "preserve",
          pendingAction: { replace: computed.pending },
        },
      });
      logCommittedTurnState(
        conversationId,
        entry,
        "operand=computed(ambiguous_view) setScreen=false",
        "preserve",
        "computed_ambiguous",
      );
      return { kind: "transform", answer: computed.message };
    }
    if (computed.kind === "empty_domain") {
      commitAssistantTurn(conversationId, {
        message: computed.answer,
        transition: {
          lens: "preserve",
          focus: "preserve",
          snapshot: "preserve",
          activeList: "preserve",
          claimState: lastTurn?.activeList ? { replace: activeListClaimState(computed.claim, lastTurn.activeList, computed.derivation) } : "clear",
          pendingAction: "clear",
        },
      });
      logCommittedTurnState(
        conversationId,
        entry,
        "operand=computed(empty_domain) setScreen=false",
        "preserve",
        "computed_empty_domain",
      );
      return { kind: "transform", answer: computed.answer };
    }
    if (computed.kind === "compute") {
      commitAssistantTurn(conversationId, {
        message: computed.answer,
        transition: {
          lens: "preserve",
          focus: { replace: [computed.ticker] },
          snapshot: "preserve",
          activeList: "preserve",
          claimState: lastTurn?.activeList ? { replace: activeListClaimState(computed.claim, lastTurn.activeList, computed.derivation) } : "clear",
          pendingAction: "clear",
        },
      });
      logCommittedTurnState(
        conversationId,
        entry,
        "operand=computed(within_view) setScreen=false",
        "preserve",
        "computed_within_view",
        ` ticker=${computed.ticker}`,
      );
      return { kind: "transform", answer: computed.answer };
    }
    if (computed.kind === "refine_set") {
      // Super-table superlative ("其中市值最大" / "业绩最强"): the set is materialized from the
      // bound view; re-classify the explicit-ticker query so the right source is fetched AND
      // the time-guard reroute runs (normalize). The parent list is preserved by the normal
      // commit (the set members ∈ the list). See computed.ts + docs/TURN_KIND_PHASE_4B_PLAN.md.
      const classification = await classifyTurn(computed.effectiveQuery, history, conversationLanguage);
      const plan = resolvePlan(classification, history, computed.effectiveQuery, lastTurn?.activeList?.list);
      logger.info(
        `🧮 REFINE_SET conv=${conversationId} set=[${computed.tickers.join(",")}] ` +
        `lens=${classification.required_data.join("+")}`,
      );
      return {
        kind: "answer",
        classification,
        plan,
        history,
        conversationLanguage,
        frame: frameFromTurn(classification, plan),
        resolvedUserMessage: computed.effectiveQuery,
      };
    }

    // DRILL_IN (Phase 4b-2): an ordinal ("第六个" / "the first one") or a bare member
    // reference resolves to ONE row of the active list and fetches a single-ticker drill.
    // Runs BEFORE classify because the classifier cannot map an ordinal to a ticker (no
    // entity in the text). Supported single lenses are planned deterministically; other
    // intents classify only after the ticker is resolved. The parent list is preserved by
    // the normal commit (member_reference — the drilled ticker ∈ the list). See
    // docs/TURN_KIND_PHASE_4B_PLAN.md §4-2.
    const drill = resolveDrill(userMessage, lastTurn?.activeList, conversationLanguage);
    if (drill.kind === "clarify") {
      commitAssistantTurn(conversationId, {
        message: drill.message,
        transition: {
          lens: "preserve",
          focus: "preserve",
          snapshot: "preserve",
          activeList: "preserve",
          claimState: "preserve",
          pendingAction: "preserve",
        },
      });
      logCommittedTurnState(
        conversationId,
        entry,
        `operand=drill(${drill.reason}) setScreen=false`,
        "preserve",
        `drill_${drill.reason}`,
      );
      return { kind: "transform", answer: drill.message };
    }
    if (drill.kind === "classify") {
      const classification = await classifyTurn(drill.effectiveQuery, history, conversationLanguage);
      const plan = resolvePlan(classification, history, drill.effectiveQuery, lastTurn?.activeList?.list);
      logger.info(
        `🔬 DRILL_IN classify conv=${conversationId} ticker=${drill.item.ticker} ` +
        `lens=${classification.required_data.join("+")}`,
      );
      return {
        kind: "answer",
        classification,
        plan,
        history,
        conversationLanguage,
        frame: frameFromTurn(classification, plan),
        resolvedUserMessage: drill.effectiveQuery,
      };
    }
    if (drill.kind === "drill") {
      const plan = resolvePlan(drill.classification, history, drill.effectiveQuery, lastTurn?.activeList?.list);
      logger.info(
        `🔬 DRILL_IN conv=${conversationId} ticker=${drill.item.ticker} ` +
        `lens=${drill.classification.required_data.join("+")}`,
      );
      return {
        kind: "answer",
        classification: drill.classification,
        plan,
        history,
        conversationLanguage,
        frame: frameFromTurn(drill.classification, plan),
        resolvedUserMessage: drill.effectiveQuery,
      };
    }
  }

  // classify — needed by both FRESH and CORRECT (entity resolution).
  const classification = await classifyTurn(userMessage, history, conversationLanguage);

  // CORRECT patch — inherit the prior turn's lens, swap the entity. Fail → fall back to FRESH.
  if (isCorrection) {
    const patched = patchCorrectedPlan(classification, lastTurn!);
    if (patched) {
      logger.info("🩹 CORRECT：沿用上一轮 lens，替换实体重跑");
      return {
        kind: "answer",
        classification: patched.classification,
        plan: patched.plan,
        history,
        conversationLanguage,
        frame: frameFromTurn(patched.classification, patched.plan),
      };
    }
    logger.info("🩹 CORRECT 消解失败 → 回落 FRESH");
  }

  // Set-screen detection reads the prior turn's structured activeList (turn_kind 4b-0),
  // not a history-text scan — so a 4a RECALL prose turn between the list and the screen
  // no longer breaks "其中…/of these" (the activeList is preserved across it).
  const plan = resolvePlan(classification, history, userMessage, lastTurn?.activeList?.list);
  return {
    kind: "answer",
    classification,
    plan,
    history,
    conversationLanguage,
    frame: frameFromTurn(classification, plan),
  };
}

/**
 * Agent主入口：处理用户消息并返回回答
 */
export async function chat(
  conversationId: string,
  userMessage: string
): Promise<AgentResponse> {
  const startTime = Date.now();
  logger.info(`\n🤖 Agent开始处理: "${userMessage}"`);

  // 创建总超时控制（120秒）
  const abortController = new AbortController();
  const timeoutId = setTimeout(() => {
    logger.warn("⏰ Agent处理超时（180秒），中止请求");
    abortController.abort();
  }, 180000);

  try {
    // 1-6. 共享前半身（persist user → history → language → TRANSFORM 短路 → 分类 → 计划）
    const prep = await prepareTurn(conversationId, userMessage, "chat");
    if (prep.kind === "transform") {
      clearTimeout(timeoutId);
      return {
        success: true,
        answer: prep.answer,
        conversationId,
        metadata: { requiredData: [], tickers: [], apiCallCount: 0, totalTime: Date.now() - startTime, skipDeepseek: true },
      };
    }
    const { classification, plan, history, conversationLanguage, frame } = prep;
    const resolvedUserMessage = prep.resolvedUserMessage ?? userMessage;
    const apiData = await fetchTurnData(plan, resolvedUserMessage, conversationLanguage);
    // Snapshot frozen at fetch time (capturedAt + each source's asOf) — see buildSnapshot.
    const snapshot = apiData ? buildSnapshot(apiData) : undefined;

    // 6. 生成回答 — Investment Brief（plan.answerMode === "BRIEF"）仅用于明确的投资
    // 决策类问题；其它一律 SIMPLE。chat() 是非流式孪生，不走 NEWS_BRIEF：live 分类器
    // 不带 newsContext，故 plan.answerMode 实际只会是 SIMPLE / BRIEF（NEWS_BRIEF 在此
    // 折叠为 SIMPLE，与改造前的 isDecisionQuery 行为逐位一致）。
    logger.info("💬 [3/3] 生成回答");
    const generalKnowledgeOnly = classification.need_api === false;
    const answerMode = plan.answerMode === "BRIEF"
      ? undefined
      : {
          type: "SIMPLE" as const,
          context: generalKnowledgeOnly ? { generalKnowledgeOnly: true } : undefined,
        };
    if (plan.answerMode !== "BRIEF") {
      logger.info("📝 使用 SIMPLE 普通回答模式（非投资决策类问题）");
    }
    const answer = await generateAnswerStream(
      resolvedUserMessage,
      apiData,
      history.slice(0, -1), // strip current turn — it's re-injected via userContent (avoid double-count)
      (chunk) => chunk,
      conversationLanguage,
      answerMode,
    );

    // 6. 原子提交：助手回复 + lastTurn 帧 + 数据快照一次落定（仅在生成成功后）。
    // chat() has no list-card path → never establishes an activeList; a set-screen
    // follow-up here degrades to FRESH. The activeList capability is chatStream-only
    // (docs/TURN_KIND_PHASE_4B_PLAN.md Rev 4 ②).
    const { transition: activeListTransition, reason: alReason } = activeListTransitionFor(
      conversationId,
      userMessage,
      plan,
      undefined, // chat() renders no list card
    );
    commitAssistantTurn(conversationId, {
      message: answer,
      transition: answerTurnTransition(frame, snapshot, activeListTransition, "clear", answerClaimTransition(snapshot, frame, true)),
    });
    logTurnDecision(conversationId, "chat", plan, activeListTransition, alReason);

    const totalTime = Date.now() - startTime;
    logger.success(`\n✅ 完成 - 总耗时 ${totalTime}ms\n`);

    // 清除超时定时器
    clearTimeout(timeoutId);

    return {
      success: true,
      answer: answer,
      conversationId,
      metadata: {
        requiredData: classification.required_data,
        tickers: classification.tickers || [],
        apiCallCount: classification.required_data.length,
        totalTime,
        competitiveProvider: apiData?.COMPETITIVE?._meta?.provider,
        degraded: classification.degraded,
      },
    };
  } catch (error) {
    logger.error("❌ Agent处理失败:", error);

    // 清除超时定时器
    clearTimeout(timeoutId);

    // 降级：返回友好错误消息
    const errorMessage =
      error instanceof Error && error.name === "AbortError"
        ? `抱歉，处理超时了（请求过于复杂或网络较慢）。请尝试简化问题或稍后再试。`
        : `抱歉，处理您的问题时遇到了一些问题。请稍后再试，或换个方式提问。`;

    return {
      success: false,
      answer: errorMessage,
      conversationId,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

/**
 * Agent主入口：流式处理用户消息
 */
export async function chatStream(
  conversationId: string,
  userMessage: string,
  onChunk: (chunk: string) => void,
  onToolCall?: (info: { dataSource: string; status: 'start' | 'success' | 'error'; data?: any; error?: string; duration?: number }) => void,
  preClassification?: any, // DISABLED 2026-06-19 (kept for signature stability): branch below commented out — backend always classifies. Trusting a client-supplied classification let clients override server routing. News Brief (its only ex-consumer) now uses POST /api/agent/news-brief.
  onPayload?: (event: AgentStreamPayload) => void,
  clientSignal?: AbortSignal, // SSE client-disconnect — cancels in-flight LLM work
): Promise<AgentResponse> {
  const startTime = Date.now();
  logger.info(`\n🤖 Agent开始流式处理: "${userMessage}"`);

  const abortController = new AbortController();
  const timeoutId = setTimeout(() => {
    logger.warn("⏰ Agent处理超时（180秒），中止请求");
    abortController.abort("pipeline_timeout");
  }, 180000);

  // Propagate SSE client-disconnect into the pipeline so downstream LLM calls
  // abort (and stop burning tokens) instead of generating into a dead socket.
  if (clientSignal) {
    const onClientAbort = () => {
      logger.warn("🔌 客户端断开连接，中止下游 LLM 调用");
      abortController.abort("client_disconnect");
    };
    if (clientSignal.aborted) onClientAbort();
    else clientSignal.addEventListener("abort", onClientAbort, { once: true });
  }

  try {
    // 1-6. 共享前半身（见 prepareTurn）。preClassification 路径已禁用（2026-06-19，
    // 签名保留）：唯一消费者 News Brief 已改用 /api/agent/news-brief；无条件信任客户端
    // 分类会让客户端操控服务端路由。一律走服务端分类。
    const prep = await prepareTurn(conversationId, userMessage, "stream");
    if (prep.kind === "transform") {
      onChunk(prep.answer);
      clearTimeout(timeoutId);
      return {
        success: true,
        answer: prep.answer,
        conversationId,
        metadata: { requiredData: [], tickers: [], apiCallCount: 0, totalTime: Date.now() - startTime, skipDeepseek: true },
      };
    }
    const { classification, plan, history, conversationLanguage, frame } = prep;
    const resolvedUserMessage = prep.resolvedUserMessage ?? userMessage;

    // 4b. 把最终分类回传前端，供 News Brief 按钮 / ticker 上下文使用
    //     （前端不再自己调 /classify-intents-multi，改由这里下发）
    if (onPayload) {
      onPayload({
        type: "classification",
        required_data: classification.required_data ?? [],
        intents: classification.required_data ?? [],
        tickers: classification.tickers ?? [],
        primary_focus: classification.primary_focus ?? "GENERAL",
        reasoning: classification.reasoning ?? "",
        confidence: classification.confidence ?? 0,
      });
    }

    // 5. 并行调用API（共享 front-half，见 fetchTurnData）。
    // 流式路径额外：单意图 PERFORMANCE 注入 fetchMetrics + 透传 onToolCall 工具事件。
    const isSinglePerformance =
      classification.required_data.length === 1 &&
      classification.required_data[0] === "PERFORMANCE";
    const apiData = await fetchTurnData(plan, resolvedUserMessage, conversationLanguage, {
      onToolCall,
      enablePerformanceMetrics: isSinglePerformance,
    });
    // Snapshot frozen at fetch time (capturedAt + each source's asOf) — see buildSnapshot.
    const snapshot = apiData ? buildSnapshot(apiData) : undefined;

    // =====================================================
    // ⚡ 单意图直接卡片优化：跳过 DeepSeek LLM 生成
    // 决策（gate / api-failure 短路 / 形态 guard / 分支优先级）= 纯函数
    // resolveRenderPlan；此处只做 IO（透传 / persist / return）。
    //
    // 所有出口（news_v2 / source_card / html_card / 生成段）收进单点的 produceOutcome()：
    // 每条分支只 return 纯数据 outcome（onPayload/onChunk 仍在分支内，但不在分支里
    // persist/commit/clearTimeout）。返回类型逼每条分支都 return → 漏一条 tsc 直接不过。
    // 唯一的 commitAssistantTurn / clearTimeout / 总耗时 在 produceOutcome 外、单点收口
    // （原子提交 message+帧+快照；生成失败抛出 → 不提交 → 上一轮帧/快照保留）。
    // =====================================================
    /** message = persisted to history (list cards store the projection, not HTML);
     *  answer = returned to the caller; metadata sans the wrapper-stamped totalTime;
     *  activeList = the operable parent list this turn rendered (only when a list card
     *  with a ≥2-routable view was emitted — §1.6), to become next turn's screen target. */
    type StreamOutcome = {
      message: string;
      answer: string;
      metadata: Omit<NonNullable<AgentResponse["metadata"]>, "totalTime">;
      activeList?: ActiveListState;
      /** True only when this turn produced a SYNTHESIZED narrative (the LLM generate path).
       *  Direct cards (board / news / source_card) leave it false: they have no conclusion to
       *  justify, so a later "why" must NOT be answered as a "narrative analysis". */
      claimable?: boolean;
    };

    /** A list card establishes an activeList iff its raw payload extracts to a ≥2-routable
     *  view (TRENDING / STOCK_PICKER only in 4b-0; other sources → undefined). Capped to
     *  the UI-visible rows so ordinal/computed follow-ups only ever see what the card showed. */
    const listCardActiveList = (source: string, payload: any): ActiveListState | undefined => {
      const snap = extractListSnapshot(source, payload);
      if (!snap) return undefined; // non-list source / error payload — expected, no activeList
      const visible = capToVisible(snap);
      if (!hasRoutableView(visible)) {
        // A list source DID extract but has no ≥2-routable view — the "card shown yet no
        // activeList" case worth a forensic breadcrumb (the turn-decision trace shows none).
        logger.debug(`📋 ${source} extracted but no ≥2-routable view → no activeList`);
        return undefined;
      }
      return {
        list: visible,
        sources: snapshot?.sources ?? [],
        origin: {
          source,
          apiParams: classification.api_params?.[source],
          capturedAt: visible.capturedAt,
        },
      };
    };

    const produceOutcome = async (): Promise<StreamOutcome> => {
      const ENABLE_DIRECT_CARD = process.env.ENABLE_DIRECT_CARD !== "false"; // 默认启用
      const renderPlan = resolveRenderPlan(plan, apiData, {
        hasStructuredSink: !!onPayload,
        directCardEnabled: ENABLE_DIRECT_CARD,
      });
      // Direct-card branches transmit their payload + return an outcome. `llm` — and an
      // html_card whose formatter yields nothing — falls through to the generate section.
      // news_v2/competitive/stock_picker are only chosen when a structured sink exists, so
      // onPayload is non-null there (onPayload!).
      if (renderPlan.kind !== "llm") {
        const dataSource = renderPlan.source;
        const submodulePayload = apiData![dataSource];

        if (renderPlan.kind === "news_v2") {
          const normalized = normalizeNewsResponse(submodulePayload);
          onPayload!({ type: "news_v2", payload: normalized });

          const persistedSummary = normalized.summary?.trim() || "";
          logger.success(`\n✅ news_v2 流式完成（结构化数据透传）\n`);

          return {
            message: persistedSummary,
            answer: persistedSummary,
            metadata: {
              requiredData: classification.required_data,
              tickers: classification.tickers || [],
              apiCallCount: 1,
              skipDeepseek: true,
              directCard: true,
            },
          };
        }

        // COMPETITIVE folded onto the generic source_card channel (handled by the
        // `renderPlan.kind === "source_card"` branch below) — its projector lives in
        // shared/sourceCard.ts. See docs/CARD_RENDER_MIGRATION_PLAN.md §8.

        // STOCK_PICKER folded onto the generic source_card channel (handled by the
        // `renderPlan.kind === "source_card"` branch below). Its projector
        // (projectStockPicker, shared/listProjection.ts) handles trending-mode's
        // nested set, so the persisted classifier line still resolves "其中哪只…"
        // follow-ups. See docs/CARD_RENDER_MIGRATION_PLAN.md §8.

        if (renderPlan.kind === "source_card") {
          // Generic structured card — transmit raw payload; frontend renders it.
          onPayload!({ type: "source_card", source: dataSource, payload: submodulePayload });

          // Persist the one-line classifier projection (same line reload will project
          // from the persisted envelope) so live === reload for follow-up routing.
          const persistedSummary = projectSourceCard(dataSource, submodulePayload);
          logger.success(`\n✅ source_card 结构化数据透传完成 (${dataSource})\n`);

          return {
            message: persistedSummary,
            answer: persistedSummary,
            metadata: {
              requiredData: classification.required_data,
              tickers: classification.tickers || [],
              apiCallCount: 1,
              skipDeepseek: true,
              directCard: true,
            },
            activeList: listCardActiveList(dataSource, submodulePayload),
          };
        }

        // renderPlan.kind === "html_card"
        logger.info(`⚡ 单意图场景，跳过 DeepSeek，直接返回 ${dataSource} 卡片`);

        const cardHtml = formatDataAsCard(
          dataSource,
          submodulePayload,
          conversationLanguage
        );

        if (cardHtml) {
          const normalizedCardHtml = await localizeGeneratedHtml(
            stripEchoedUserQuestion(cardHtml, resolvedUserMessage),
            conversationLanguage,
          );

          // 通过流式接口一次性发送完整卡片
          onChunk(normalizedCardHtml);

          // 列表型源(TRENDING/MARKET_DATA)持久化"分类器投影"而非 HTML——否则下一轮
          // 「这些领涨股里哪只…」追问只能看到被 400 字符截断的卡片 markup，结果集
          // ticker 丢失。前端拿到的仍是上面 onChunk 的完整 HTML，不受影响。投影读 raw
          // submodulePayload；非列表源返回 null 回落原 HTML。详见
          // docs/HISTORY_PROJECTION_PLAN.md。reload 也走同一投影：
          // server/chatHistory.ts:toAgentHistoryContent 调 shared 的
          // projectToClassifierHistory()，html_card 信封里的 classifierText 胜出，所以
          // reload 拿到的分类器行 === live。(原先的 F-min 分叉已随 UNIFIED_TURN_HISTORY
          // 收口；详见 docs/UNIFIED_TURN_HISTORY_PLAN.md。)
          const cardProjection = projectListTurnToHistory(dataSource, submodulePayload);
          // List cards (TRENDING/MARKET_DATA): hand the client the SAME line we feed
          // the live in-memory history, so a reloaded turn routes identically.
          if (cardProjection && onPayload) {
            onPayload({ type: "history_projection", source: dataSource, text: cardProjection });
          }

          logger.success(`\n✅ 直接卡片完成（跳过 LLM）\n`);

          return {
            message: cardProjection ?? normalizedCardHtml,
            answer: normalizedCardHtml,
            metadata: {
              requiredData: classification.required_data,
              tickers: classification.tickers || [],
              apiCallCount: 1,
              skipDeepseek: true, // ✅ 标记：已跳过 LLM
              directCard: true,   // ✅ 标记：使用直接卡片
              competitiveProvider: apiData?.COMPETITIVE?._meta?.provider,
            },
            activeList: listCardActiveList(dataSource, submodulePayload),
          };
        }
        // formatDataAsCard 失败 → 降级到 LLM 生成（继续往下走到生成段）
        logger.warn(`⚠️ ${dataSource} 卡片格式化失败，降级到 DeepSeek 生成`);
      }

      // 5. 流式生成回答（多意图或不支持直接卡片的场景）
      logger.info("💬 [3/3] 流式生成回答");

      // Answer shape from the resolved plan (NEWS_BRIEF > BRIEF > SIMPLE). The
      // mode decision lives in resolvePlan; here we only attach the per-mode context.
      let specialMode: { type: string; context?: any } | undefined = undefined;
      if (plan.answerMode === "NEWS_BRIEF") {
        logger.info("📊 检测到 NEWS_BRIEF 模式，将生成结构化简报");
        specialMode = {
          type: "NEWS_BRIEF",
          context: classification.newsContext,
        };
      } else if (plan.answerMode === "SIMPLE") {
        // Default: plain-prose answer. The multi-module Investment Brief
        // template ("Verdict / Executive Summary / What Drove the Jump?") is
        // reserved for explicit "should I buy / sell" decision queries (BRIEF).
        logger.info("📝 使用 SIMPLE 普通回答模式（非投资决策类问题）");
        // When the classifier itself decided no API call is needed (concept /
        // general-knowledge query), let the LLM answer from training knowledge
        // instead of refusing with "no data". API-required failures still hit
        // the hard-refusal path because apiData will be empty *and* the flag
        // here will be undefined.
        const generalKnowledgeOnly = classification.need_api === false;
        specialMode = {
          type: "SIMPLE",
          context: generalKnowledgeOnly ? { generalKnowledgeOnly: true } : undefined,
        };
      } else {
        logger.info("📊 投资决策类问题，使用 Investment Brief 模板");
      }

      // Unified answer contract: merges the SIMPLE + Investment Brief paths into one
      // markdown-body + sidecar response. ON by default; set UNIFIED_ANSWER=false to
      // fall back to the legacy SIMPLE/Brief paths. Only the two mergeable modes route
      // here; NEWS_BRIEF / REFINE keep their existing paths untouched.
      const ENABLE_UNIFIED_ANSWER = process.env.UNIFIED_ANSWER !== "false";
      const isMergeable = !specialMode || specialMode.type === "SIMPLE";
      let answer: string;
      if (ENABLE_UNIFIED_ANSWER && isMergeable) {
        const intent = plan.answerIntent;
        logger.info(`🧩 统一回答契约（intent=${intent}）`);
        const unified = await generateUnifiedAnswer(
          resolvedUserMessage,
          apiData,
          history.slice(0, -1),
          conversationLanguage,
          intent,
          abortController.signal,
        );
        if (onPayload) onPayload({ type: "unified_answer", payload: unified });
        onChunk(unified.body);
        answer = unified.body;
      } else {
        answer = await generateAnswerStream(
          resolvedUserMessage,
          apiData,
          history.slice(0, -1), // strip current turn — it's re-injected via userContent (avoid double-count)
          onChunk,
          conversationLanguage,
          specialMode,
          abortController.signal,
        );
      }

      logger.success(`\n✅ 流式完成\n`);
      return {
        message: answer,
        answer,
        metadata: {
          requiredData: classification.required_data,
          tickers: classification.tickers || [],
          apiCallCount: classification.required_data.length,
          competitiveProvider: apiData?.COMPETITIVE?._meta?.provider,
          degraded: classification.degraded,
        },
        claimable: true, // a synthesized narrative — a later "why" can be justified
      };
    };

    const outcome = await produceOutcome();
    // 6. 原子提交：助手回复 + lastTurn 帧 + 数据快照 + activeList 转移一次落定（生成失败抛出则
    // 不到这里 → 上一轮帧/快照/列表保留）。activeList 转移（§三表）：本轮渲了可操作列表 → replace；
    // 否则见 activeListTransitionFor（set-screen 或仅是引用了集合 → preserve；都不是 → clear）。
    const { transition: activeListTransition, reason: alReason } = activeListTransitionFor(
      conversationId,
      userMessage,
      plan,
      outcome.activeList,
    );
    commitAssistantTurn(conversationId, {
      message: outcome.message,
      transition: answerTurnTransition(frame, snapshot, activeListTransition, "clear", answerClaimTransition(snapshot, frame, outcome.claimable ?? false)),
    });
    logTurnDecision(conversationId, "stream", plan, activeListTransition, alReason);
    clearTimeout(timeoutId);

    return {
      success: true,
      answer: outcome.answer,
      conversationId,
      metadata: { ...outcome.metadata, totalTime: Date.now() - startTime },
    };
  } catch (error) {
    logger.error("❌ Agent流式处理失败:", error);
    clearTimeout(timeoutId);

    const errorMessage =
      error instanceof Error && error.name === "AbortError"
        ? `抱歉，处理超时了。请尝试简化问题或稍后再试。`
        : `抱歉，处理您的问题时遇到了一些问题。`;

    return {
      success: false,
      answer: errorMessage,
      conversationId,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

/**
 * 调用意图分类（进程内直连，不再回环 HTTP 到 /api/classify-intents-multi）
 */
async function classifyIntent(
  userMessage: string,
  history: Message[],
  language: "en" | "zh" = "en"
) {
  const conversationHistory = history.map((msg) => ({
    role: msg.role,
    content: msg.content,
  }));

  const data = await classifyIntents(userMessage, conversationHistory, language);

  return {
    required_data: data.required_data || [],
    primary_focus: data.primary_focus || "GENERAL",
    tickers: data.tickers || [],
    need_api: data.need_api !== false,
    api_params: data.api_params || {},
    confidence: data.confidence || 0.7,
    reasoning: data.reasoning || "",
  };
}
