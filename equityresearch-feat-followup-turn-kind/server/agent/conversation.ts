// 对话历史管理模块（Short Memory）
import { logger } from "../utils";
import type { AnswerIntent } from "./answerIntent";
import type { Source } from "./provenance";
import type { ClaimState } from "./claim";
import type { ListSnapshot } from "@shared/listSnapshot";

export interface Message {
  role: "user" | "assistant";
  content: string;
  timestamp: Date;
}

/**
 * Per-turn data snapshot — the values actually retrieved last turn + their frozen
 * source metadata (turn_kind Phase 4a). Captured at fetch time (NOT at recall time)
 * so a later RECALL answers "as of when we fetched", never "as of the follow-up".
 * `sources` is built once here (asOf stamped at capture) and read verbatim by
 * answerRecall — never rebuilt. Lives only in the active in-process conversation;
 * not reconstructable from DB, so reload clears it. See
 * docs/TURN_KIND_PHASE_4A_PLAN.md.
 */
export interface LastAnswerSnapshot {
  capturedAt: string; // ISO, frozen at fetch time
  validData: Record<string, any>; // simplified, per-element-filtered retrieved data
  sources: Source[]; // built once at capture; asOf already frozen
}

/** Server-owned wrapper around the shared list shape. Evidence and origin belong to the
 *  parent list, not to the latest focus snapshot/lens (which a DRILL may replace). */
export interface ActiveListState {
  list: ListSnapshot;
  sources: Source[];
  origin: {
    source: string;
    slice?: string;
    apiParams?: Record<string, unknown>;
    capturedAt: string;
  };
}

/**
 * Structured frame of the previous ANSWER turn — the conversation's stateful memory
 * (turn_kind gate). Replaces the old write-only `recentTickers`. Consumed by the
 * CORRECT exit (turnKind Phase 3): a correction re-runs the prior turn's intent with
 * the entity swapped, so it needs the prior classification + lens, not just text.
 * source/slice/asOf are forward-looking for DRILL_IN/RECALL (Phase 4).
 */
export interface LastTurnFrame {
  classification: {
    required_data: string[];
    primary_focus: string;
    tickers: string[];
    api_params: Record<string, any>;
    need_api: boolean;
  };
  answerIntent: AnswerIntent; // the prior lens (plan.answerIntent)
  resultTickers: string[]; // tickers actually in scope last turn (plan.entities symbols)
  source?: string;
  slice?: string;
  asOf?: string;
  /** Per-turn data snapshot (turn_kind Phase 4a). Absent when the turn fetched no
   *  data (need_api=false) or every source failed — RECALL gracefully defers then. */
  snapshot?: LastAnswerSnapshot;
  /** The operable parent list shown last turn (turn_kind Phase 4b). Lives on the FRAME,
   *  not the snapshot: snapshot is replaced every data turn, but a list must survive a
   *  DRILL/RECALL follow-up (it is the set "其中…/of these" screens). Established only
   *  when a list card rendered with a ≥2-routable view (§1.6); transitioned explicitly
   *  by applyTurnTransition (never "inherit if present"). */
  activeList?: ActiveListState;
  /** Last turn's conclusion layer (computed / momentum; RECALL + JUSTIFY consume it). One
   *  claim today; multi-claim awaits task-centric Phase 5. See ./claim.ts. */
  claimState?: ClaimState;
  /** A deterministic follow-up waiting for one short user choice. Kept separate from
   *  claim: claim is a completed conclusion; pendingAction is unfinished work. */
  pendingAction?: PendingAction;
}

export type SetChoiceCriterion = "balanced" | "valuation" | "fundamentals" | "momentum" | "news";

export interface PendingSetChoice {
  kind: "set_choice";
  stage: "awaiting_view" | "awaiting_criterion" | "awaiting_scope";
  activeListCapturedAt: string;
  viewId?: string;
  criterion?: SetChoiceCriterion;
}

export interface PendingComputed {
  kind: "computed";
  stage: "awaiting_view";
  activeListCapturedAt: string;
  /** Original superlative; combined with the user's short view-name reply. */
  query: string;
}

export type PendingAction = PendingSetChoice | PendingComputed;

// ============================================================================
// Turn state machine (turn_kind Phase 4b). The conversation's stateful memory has
// independently-lived slots: the routing `lens` (classification/answerIntent),
// the current `focus` (resultTickers — what "它/这些" points at), the last `snapshot`
// (evidence, replaced every data turn), and the `activeList` (the operable parent list,
// preserved across DRILL/RECALL), plus claim/pendingAction. Every committed turn exit must
// declare an EXPLICIT transition for
// each — "inherit if present" is exactly the bug that let an old list pollute a FRESH turn
// or a prose reply break a later set-screen. applyTurnTransition is the ONE place the next
// frame is computed; it is a pure function, fully table-tested before any IO is wired.
//
// This GENERALIZES (replaces) the Phase-4a whole-frame replace in commitAssistantTurn and
// the `{kind:"transform"}` skip-commit exits — 4b-0 is therefore NOT purely additive.
// See docs/TURN_KIND_PHASE_4B_PLAN.md §三 + §五.
// ============================================================================

/** Per-field state transition: keep the prior value, drop it, or set a new one. */
export type StateTransition<T> = "preserve" | "clear" | { replace: T };

/** The routing lens — everything in LastTurnFrame EXCEPT the independently-managed
 *  focus/snapshot/activeList/claimState/pendingAction fields. */
type TurnLens = Pick<LastTurnFrame, "classification" | "answerIntent" | "source" | "slice" | "asOf">;

/** A turn's complete, explicit effect on the stateful frame. EVERY slot is explicit
 *  (no implicit "inherit if absent"): an answer turn replaces the lens, a computed-RECALL
 *  / pure short-circuit preserves it. A FRESH turn that forgot to set lens would be a type
 *  error, not a silent stale-lens inherit. */
export interface TurnStateTransition {
  lens: "preserve" | { replace: TurnLens };
  focus: StateTransition<string[]>; // resultTickers
  snapshot: StateTransition<LastAnswerSnapshot>;
  activeList: StateTransition<ActiveListState>;
  claimState: StateTransition<ClaimState>;
  pendingAction: StateTransition<PendingAction>;
}

function lensOf(f: LastTurnFrame): TurnLens {
  return {
    classification: f.classification,
    answerIntent: f.answerIntent,
    source: f.source,
    slice: f.slice,
    asOf: f.asOf,
  };
}

function resolveField<T>(prev: T | undefined, t: StateTransition<T>): T | undefined {
  if (t === "preserve") return prev;
  if (t === "clear") return undefined;
  return t.replace;
}

/**
 * Compute the next frame from the prior frame + a turn's transition. Pure (no IO).
 * A transition with no lens AND no prior frame (a turn-1 short-circuit) has nothing to
 * commit → returns the prior frame unchanged (null).
 */
export function applyTurnTransition(
  prev: LastTurnFrame | null,
  t: TurnStateTransition,
): LastTurnFrame | null {
  const lens: TurnLens | null =
    t.lens === "preserve" ? (prev ? lensOf(prev) : null) : t.lens.replace;
  if (!lens) {
    // lens="preserve" with no prior frame = a turn-1 no-op short-circuit. If the
    // transition ALSO carries replace/clear in another slot, that effect would be
    // silently dropped here — a mis-constructed transition. Surface it in dev/test
    // (never a false green); stay a no-op in production.
    if (
      process.env.NODE_ENV !== "production" &&
      (t.focus !== "preserve" ||
        t.snapshot !== "preserve" ||
        t.activeList !== "preserve" ||
        t.claimState !== "preserve" ||
        t.pendingAction !== "preserve")
    ) {
      throw new Error(
        "applyTurnTransition: lens=preserve with no prior frame, but another slot is replace/clear — mis-constructed transition (its effect would be silently dropped).",
      );
    }
    return prev;
  }
  return {
    ...lens,
    resultTickers: resolveField(prev?.resultTickers, t.focus) ?? [],
    snapshot: resolveField(prev?.snapshot, t.snapshot),
    activeList: resolveField(prev?.activeList, t.activeList),
    claimState: resolveField(prev?.claimState, t.claimState),
    pendingAction: resolveField(prev?.pendingAction, t.pendingAction),
  };
}

/**
 * The standard transition for a normal answer turn: replace lens + focus + snapshot
 * (data turn → its snapshot, else clear), and apply the caller-decided activeList
 * transition (replace a new list / preserve the parent on a set-screen / clear on a
 * fresh non-list entity). claimState follows the frame (none on a plain answer → clear).
 */
export function answerTurnTransition(
  frame: LastTurnFrame,
  snapshot: LastAnswerSnapshot | undefined,
  activeList: StateTransition<ActiveListState>,
  pendingAction: StateTransition<PendingAction> = "clear",
  claimState?: StateTransition<ClaimState>,
): TurnStateTransition {
  return {
    lens: { replace: lensOf(frame) },
    focus: { replace: frame.resultTickers },
    snapshot: snapshot ? { replace: snapshot } : "clear",
    activeList,
    // Caller may attach a synthesized claim (DRILL / plain data answer) so a later "why"
    // reaches JUSTIFY; otherwise follow the frame (none on a plain answer → clear).
    claimState: claimState ?? (frame.claimState ? { replace: frame.claimState } : "clear"),
    pendingAction,
  };
}

export interface Conversation {
  id: string;
  messages: Message[];
  context: {
    /** Structured frame of the previous answer turn (turn_kind gate); null on first turn. */
    lastTurn: LastTurnFrame | null;
    language: "en" | "zh";
  };
  createdAt: Date;
  updatedAt: Date;
  expiresAt: Date;
}

// 内存存储（简单实现）
const conversations = new Map<string, Conversation>();

/**
 * 获取或创建对话
 */
export function getOrCreateConversation(conversationId: string): Conversation {
  if (!conversations.has(conversationId)) {
    const now = new Date();
    conversations.set(conversationId, {
      id: conversationId,
      messages: [],
      context: {
        lastTurn: null,
        language: "en",
      },
      createdAt: now,
      updatedAt: now,
      expiresAt: new Date(now.getTime() + 60 * 60 * 1000), // 1小时后过期
    });
    logger.info(`📝 创建新对话: ${conversationId}`);
  }

  return conversations.get(conversationId)!;
}

/**
 * 添加消息到对话历史
 */
export function addMessage(
  conversationId: string,
  role: "user" | "assistant",
  content: string
): void {
  const conv = getOrCreateConversation(conversationId);

  conv.messages.push({
    role,
    content,
    timestamp: new Date(),
  });

  conv.updatedAt = new Date();

  // 限制历史长度，防止Token爆炸（保留最近20条）
  if (conv.messages.length > 20) {
    conv.messages = conv.messages.slice(-20);
  }

  logger.debug(`💬 添加消息到 ${conversationId}: ${role}`);
}

/**
 * 获取最近的消息（用于发给LLM）
 */
export function getRecentMessages(
  conversationId: string,
  limit: number = 10
): Message[] {
  const conv = getOrCreateConversation(conversationId);
  return conv.messages.slice(-limit);
}

/**
 * 用数据库历史覆盖内存会话，用于用户点击历史会话后继续追问
 */
export function replaceConversationMessages(
  conversationId: string,
  messages: Message[],
): void {
  const conv = getOrCreateConversation(conversationId);
  conv.messages = messages.slice(-20);
  conv.updatedAt = new Date();
  conv.expiresAt = new Date(Date.now() + 60 * 60 * 1000);
  // Drop the prior turn frame/snapshot: it can't be rebuilt from DB messages and
  // would no longer match the reloaded history (RECALL defers; CORRECT degrades to
  // FRESH — see docs/TURN_KIND_PHASE_4A_PLAN.md Non-goals).
  conv.context.lastTurn = null;
  logger.info(`🗂️ 会话历史已载入内存: ${conversationId}`);
}

/**
 * Atomic assistant-turn commit (turn_kind Phase 4a): persist the assistant message
 * AND the stateful lastTurn frame + data snapshot in one synchronous step, AFTER the
 * answer is known to have succeeded. Replaces the old prepareTurn-time recordLastTurn
 * (which wrote the frame before the answer existed — would have left a frame pointing
 * at a turn that failed to generate, and a snapshot referencing unshown results).
 * `snapshot` is undefined for turns that fetched no usable data → next-turn RECALL
 * defers. No await in the body: message+frame+snapshot land together or not at all.
 */
export function commitAssistantTurn(
  conversationId: string,
  turn: { message: string; transition: TurnStateTransition },
): void {
  const conv = getOrCreateConversation(conversationId);
  // Compute the next frame from the CURRENT state FIRST (pure, no IO), then land the
  // message + frame together — so a future throwing transition can't leave a persisted
  // message with a stale frame (atomic, like the Phase-4a commit it generalizes).
  const nextFrame = applyTurnTransition(conv.context.lastTurn, turn.transition);
  addMessage(conversationId, "assistant", turn.message);
  conv.context.lastTurn = nextFrame;
  const lt = conv.context.lastTurn;
  logger.debug(
    `📌 提交助手轮 ${conversationId}: ${lt?.source ?? "?"} [${lt?.resultTickers.join(", ") ?? ""}] snapshot=${lt?.snapshot ? "yes" : "no"} activeList=${lt?.activeList ? `${lt.activeList.list.views.length}v` : "no"}`,
  );
}

/**
 * 读取上一轮帧（CORRECT 消费：沿用 lens、替换实体重跑）。首轮返回 null。
 */
export function getLastTurn(conversationId: string): LastTurnFrame | null {
  const conv = getOrCreateConversation(conversationId);
  return conv.context.lastTurn;
}

/**
 * 获取对话语言
 */
export function getConversationLanguage(
  conversationId: string
): "en" | "zh" {
  const conv = getOrCreateConversation(conversationId);
  return conv.context.language;
}

/**
 * 更新对话语言
 */
export function setConversationLanguage(
  conversationId: string,
  language: "en" | "zh"
): void {
  const conv = getOrCreateConversation(conversationId);
  conv.context.language = language;
  logger.debug(`🌐 更新对话语言 ${conversationId}: ${language}`);
}

/**
 * 清理过期对话（定期调用）
 */
export function cleanExpiredConversations(): number {
  const now = Date.now();
  let cleaned = 0;

  for (const [id, conv] of Array.from(conversations.entries())) {
    if (conv.expiresAt.getTime() < now) {
      conversations.delete(id);
      cleaned++;
    }
  }

  if (cleaned > 0) {
    logger.info(`🧹 清理了 ${cleaned} 个过期对话`);
  }

  return cleaned;
}

// 每5分钟清理一次过期对话
setInterval(cleanExpiredConversations, 5 * 60 * 1000);
