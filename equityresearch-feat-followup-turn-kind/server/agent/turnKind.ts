import type { TargetLanguage } from "../translation/detect";
import type { LastAnswerSnapshot } from "./conversation";
import type { Source } from "./provenance";
import { hasRoutableView, type ListSnapshot } from "@shared/listSnapshot";
import { selectView } from "./listChoice";

// turn_kind set-screen resolution. The signal (c) once missing: "is this multi-ticker
// turn a SCREEN over the prior result set, or a comparison?" A screen → PERFORMANCE may
// fan out per ticker; a comparison must keep the primary+peers single call
// (server/performance/service.ts:25).
//
// Phase 4b-0 moves the SET TRUTH from history text to the structured `activeList`. The
// Phase-1 isSetScreen read "the most recent assistant turn is a [SOURCE …] projection
// line" — which a prose reply (e.g. a 4a RECALL "数据哪来的") inserted BETWEEN the list
// and the screen breaks (the 榜→数据哪来的→其中涨最多 dropped link). The list now lives in
// LastTurnFrame.activeList (preserved across such prose turns by applyTurnTransition), so
// resolveListOperand reads it directly — no history scan. Deterministic TS, no LLM, no
// classifier-prompt change. See docs/TURN_KIND_PHASE_4B_PLAN.md §二 + 接线-1.

/** Plural reference to a prior result set (kept in sync with the prompt SET RULE).
 *  Exported for resolveListOperand + the preserve-on-reference decision + future
 *  computed-RECALL scope detection. */
export const SET_ANAPHOR_RE = /这些|其中|哪些|哪几|这几只|那几只|of these|which of (?:them|these)|among (?:these|them)/i;

/** A persisted history-projection line: `[TRENDING …]` / `[STOCK_PICKER …]`
 *  (historyProjection.ts). Used ONLY as the reload fallback in resolveListOperand —
 *  reload drops the in-memory activeList, but this line survives in DB history. */
const PROJECTION_RE = /^\[[A-Z_]+\b/;

/** The resolved operand for a list follow-up. 4b-0 surfaces only the set-screen case
 *  (→ PERFORMANCE fan-out); the richer kinds (compute_within_view / ordinal / empty_domain
 *  / ambiguous) are 4b-1 consumers of the same activeList.
 *
 *  4b-0 deliberately does NOT attach a `view`: set-screen doesn't consume one, and the
 *  only thing we could return ("the first ≥2-routable view") is a wrong default — instead
 *  we bind the view the same way set_choice/REFINE_SET do (selectView: named view, else the
 *  sole routable view) and MATERIALIZE `tickers` from its items (4b-1, the #5 tail). When
 *  the view is ambiguous/unnamed selectView returns null → we fall back to the classifier's
 *  re-emit (`sourced: "classifier"`, no wrong default, mirrors shipped isSetScreen).
 *  See docs/TURN_KIND_PHASE_4B_PLAN.md §二 / §1.6. */
/** `reason` is decision provenance for the turn-decision trace (the resolver knows best
 *  WHY) — `none` distinguishes no-anaphor / under-emit / no-prior-list; `screen` whether
 *  the set came from the live activeList or the reload projection fallback. `sourced`
 *  records whether the operand set was materialized from the bound view's items (`view`)
 *  or kept the classifier's re-emit (`classifier`) — the fan-out fidelity signal. */
export type ListOperand =
  | { kind: "screen"; tickers: string[]; reason: "live" | "reload_fallback"; sourced: "view" | "classifier" }
  | { kind: "none"; reason: "no_anaphor" | "tickers_lt_2" | "no_prior_list" };

/**
 * Resolve whether the current turn screens the prior result set. Requires plural
 * set-anaphor + the classifier re-emitting ≥2 tickers, plus a prior list — sourced from
 * EITHER the live structured `activeList` (survives RECALL/REFINE prose within a session →
 * fixes the 榜→来源→其中… dropped link) OR, when that's been dropped (reload clears the
 * in-memory frame), the persisted projection line still in `history` (the reload fallback,
 * matching shipped isSetScreen — lower fidelity, so computed/DRILL which need the
 * structured list still defer on reload). Comparisons ("对比 A 和 B") carry no set-anaphor →
 * none. With neither source (e.g. the chat() entry, which builds no list and persists no
 * projection) a list follow-up degrades to none → FRESH.
 */
export function resolveListOperand(
  userMessage: string,
  classification: { tickers?: string[] },
  activeList: ListSnapshot | undefined,
  history?: { role: string; content: string }[],
): ListOperand {
  if (!SET_ANAPHOR_RE.test(userMessage)) return { kind: "none", reason: "no_anaphor" };
  const tickers = (classification.tickers ?? []).filter(Boolean);
  if (tickers.length < 2) return { kind: "none", reason: "tickers_lt_2" };
  if (!!activeList && hasRoutableView(activeList)) {
    // #5 materialize: screen the EXACT set the user saw. Bind the view (named, else the
    // sole routable one — same vocabulary as set_choice/REFINE_SET) and take its items
    // rather than trusting the classifier's re-emit, which can drop members (activeList
    // holds ≤10, the classifier might echo only 3 → we'd silently screen 3). §1.6:
    // activeList is already capToVisible-capped, so view.items IS "these on screen".
    // selectView returns null when ambiguous/unnamed → keep the classifier set (no wrong
    // default, no regression vs shipped isSetScreen).
    const view = selectView(userMessage, activeList);
    const materialized = view
      ? ([...new Set(view.items.map((i) => i.ticker?.toUpperCase()).filter(Boolean))] as string[])
      : [];
    return materialized.length >= 2
      ? { kind: "screen", tickers: materialized, reason: "live", sourced: "view" }
      : { kind: "screen", tickers, reason: "live", sourced: "classifier" };
  }
  if (isRecentProjectionLine(history)) return { kind: "screen", tickers, reason: "reload_fallback", sourced: "classifier" };
  return { kind: "none", reason: "no_prior_list" };
}

/** True when the most recent assistant turn in history is a persisted list projection
 *  line — the reload-time stand-in for a (dropped) structured activeList. */
function isRecentProjectionLine(history?: { role: string; content: string }[]): boolean {
  if (!history) return false;
  const lastAssistant = [...history].reverse().find((m) => m.role === "assistant");
  return !!lastAssistant && PROJECTION_RE.test(lastAssistant.content.trim());
}

// ============================================================================
// TRANSFORM / translate — Phase 2 deterministic short-circuit.
//
// The chat path has no translate/TRANSFORM axis (classifyIntents only routes
// finance intents), so "translate <X> into <lang>" gets dragged into a provider
// by the named entity ("Translate Tesla earnings call into Chinese" → EARNINGS +
// TSLA + need_api=true — a stable mis-route confirmed on both DeepSeek and 9B).
// Per the LLM/TS boundary, recognizing a *command* is TS's job, not the LLM's:
// this fires BEFORE classifyTurn so the turn never reaches a provider — it goes
// straight to translateTextToLanguage. See docs/FOLLOWUP_TURN_GATE_DESIGN.md §十二.
//
// The hard part is NOT over-firing. The discriminators:
//   • translate VERB required ("翻译"/"translate") — so "用中文解释 …" / "in Chinese"
//     (outputLanguage, keeps its finance intent) is excluded by construction.
//   • explicit TARGET language required (mirrors the §十二 patterns 翻译…成X /
//     translate…into X) — a bare "翻译上面的" with no target stays ambiguous → defer.
//   • a deterministically RESOLVABLE payload required — inline text after a colon,
//     or an anaphor / bare command pointing at the prior assistant turn. A command
//     naming a fetchable object ("Tesla earnings call") resolves to neither → we
//     decline and let the classifier handle it (today's known soft-red gap).
// ============================================================================

/** Result of the deterministic translate-command detector. */
export interface TranslateCommand {
  operationType: "TRANSFORM";
  transform: "translate";
  targetLanguage: TargetLanguage;
  /** inline_text = the "…：<text>" payload; previous_assistant_message = prior turn. */
  payloadSource: "inline_text" | "previous_assistant_message";
  /** Resolved text to translate (inline text, or the prior assistant turn's content). */
  payloadText: string;
}

/** Translate VERB — 翻译/译成/译为 (zh) or the word `translate` (en). */
const ZH_TRANSLATE_RE = /翻译|译成|译为/;
const EN_TRANSLATE_RE = /\btranslate\b/i;
/** Target-language tokens. */
const TARGET_LANG_RE = /中文|汉语|普通话|chinese|mandarin|英文|英语|english/gi;
/** Anaphor pointing at the prior assistant turn ("翻译上面的" / "translate that"). */
const ANAPHOR_RE = /上面|上文|前面|以上|上一[条段句]|刚才|这段|\bthat\b|\bthis\b|\bit\b|the above|the previous/i;

function detectTargetLanguage(text: string): TargetLanguage | null {
  if (/中文|汉语|普通话|chinese|mandarin/i.test(text)) return "zh";
  if (/英文|英语|english/i.test(text)) return "en";
  return null;
}

/** A quoted span (straight/curly/CJK quotes) — an explicit "this exact string". */
const QUOTED_RE = /[“"]([^“”"]+)[”"]|'([^']+)'|「([^」]+)」|『([^』]+)』|《([^》]+)》/;

function isSubstantive(s: string): boolean {
  return s.length >= 2 && /[A-Za-z一-鿿]/.test(s);
}

/**
 * Inline payload — text the user marked as the literal thing to translate:
 *  (a) a quoted span, but ONLY when the quote IS the whole object (residual is a
 *      bare command). `translate "Tesla earnings call" into Chinese` → that span;
 *      `translate the "Tesla earnings call" transcript …` → quotes just name a
 *      fetchable object, residual is not bare → defer (don't treat as payload).
 *  (b) text after a `:` / `：` / newline delimiter (翻译成中文：<text>).
 */
function extractInlinePayload(text: string): string | null {
  const q = text.match(QUOTED_RE);
  if (q) {
    const span = (q[1] ?? q[2] ?? q[3] ?? q[4] ?? q[5] ?? "").trim();
    if (isSubstantive(span) && isBareCommand(text.replace(q[0], " "))) return span;
  }
  const m = text.match(/[:：\n]\s*([\s\S]+)/);
  if (m) {
    const rest = m[1].trim();
    if (isSubstantive(rest)) return rest;
  }
  return null;
}

/** True when nothing substantive remains beyond the translate verb + target token. */
function isBareCommand(text: string): boolean {
  const residual = text
    .replace(ZH_TRANSLATE_RE, "")
    .replace(EN_TRANSLATE_RE, "")
    .replace(TARGET_LANG_RE, "")
    .replace(/把|请|帮我|一下|吧|成|为|into|to|the|please/gi, "")
    .replace(/[\s\p{P}]/gu, "");
  return residual.length === 0;
}

/**
 * Detect a translate COMMAND deterministically (no LLM). Returns a resolved
 * TranslateCommand (with the actual text to translate) or null to defer to the
 * classifier. history already includes the current user turn — the prior
 * assistant turn is found by skipping past it.
 */
export function detectTranslateCommand(
  userMessage: string,
  history: { role: string; content: string }[],
): TranslateCommand | null {
  const text = userMessage.trim();
  const targetLanguage = detectTargetLanguage(text);
  const isCommand = ZH_TRANSLATE_RE.test(text) || EN_TRANSLATE_RE.test(text);
  if (!targetLanguage || !isCommand) return null;

  // (1) inline_text — explicit "<command>：<text>" payload.
  const inline = extractInlinePayload(text);
  if (inline) {
    return base(targetLanguage, "inline_text", inline);
  }

  // (2) previous_assistant_message — anaphor or bare command + a prior turn.
  if (ANAPHOR_RE.test(text) || isBareCommand(text)) {
    const lastAssistant = [...history].reverse().find((m) => m.role === "assistant");
    const prior = lastAssistant?.content?.trim();
    if (prior) return base(targetLanguage, "previous_assistant_message", prior);
  }

  // (3) Command names a fetchable object ("translate Tesla earnings call into
  // Chinese") — no resolvable payload → defer (DESIGN §十二 soft-red target).
  return null;
}

function base(
  targetLanguage: TargetLanguage,
  payloadSource: TranslateCommand["payloadSource"],
  payloadText: string,
): TranslateCommand {
  return { operationType: "TRANSFORM", transform: "translate", targetLanguage, payloadSource, payloadText };
}

// ============================================================================
// CORRECT — Phase 3. "我说的是X不是Y / 不是百度，是阿里 / no, I meant X". The highest-
// precedence turn-kind: today a correction is mis-read as a FRESH turn and loses the
// prior lens (re-runs as a generic new query instead of re-running the prior intent
// with the entity swapped). detectCorrection only flags the correction STRUCTURE;
// the corrected NAME→ticker is resolved by the classifier (a regex can't map 阿里→BABA),
// then patchCorrectedPlan (resolvePlan.ts) inherits the prior turn's lens. Gated on a
// prior frame existing (never fires turn 1) and falls back to FRESH if unresolvable.
// ============================================================================

/**
 * A correction structure pointing at the prior turn's request. Conservative on
 * purpose — a plain new-entity mention ("苹果呢?") must NOT match (it's FRESH). The
 * 不是…是… / 是…不是… shapes carry the corrected and wrong entities; the English
 * "I meant / I said X not Y" forms mirror them.
 */
const CORRECTION_RE =
  /不是.{0,20}?(?:而是|，?\s*是)|(?:我\s*)?(?:说的|问的|想问的|要问的|指的)\s*是|应该是.{0,12}不是|是.{1,16}不是|\bno,?\s+i\s+meant\b|\bi\s+meant\b|\bi\s+said\b.{0,30}\bnot\b|\bnot\b.{0,30},?\s*i\s+meant\b/i;

export function detectCorrection(userMessage: string): boolean {
  return CORRECTION_RE.test(userMessage.trim());
}

// ============================================================================
// CHITCHAT — Phase 3. Pleasantries + capability questions: zero content action,
// need_api=false, no fetch (DESIGN §4.2). A cheap pre-classify rule short-circuit
// like TRANSFORM. Whole-message-anchored so finance queries never match.
// ============================================================================

/** Whole-message pleasantry (谢谢/好的/thanks/ok). Anchored: "谢谢分析苹果" won't match. */
const PLEASANTRY_RE =
  /^(?:谢谢|多谢|感谢|谢啦|好的|好滴|好吧|行|嗯+|可以了|不用了|没事了|算了|ok|okay|k|thanks?|thank you|thx|ty|got it|cool|nice|great|👍|🙏)[\s!！。.~、，,]*$/i;

/** Capability / meta questions about the assistant itself. */
const CAPABILITY_RE =
  /你(能|可以|都能|还能)(做|干|帮我做|分析|查)(什么|啥|哪些)|有(什么|哪些)(功能|本事|能力)|能(不能|否)?导出|怎么(用|使用)你|你是(谁|什么)|你叫什么|what can you do|who are you|what are you|can you export|how (do|can) (i|you) use/i;

export type ChitchatKind = "pleasantry" | "capability";

export function detectChitchat(userMessage: string): ChitchatKind | null {
  const t = userMessage.trim();
  if (PLEASANTRY_RE.test(t)) return "pleasantry";
  if (CAPABILITY_RE.test(t)) return "capability";
  return null;
}

/** Canned, localized chitchat reply — deterministic, no LLM call (套话/能力说明). */
export function answerChitchat(kind: ChitchatKind, language: "en" | "zh"): string {
  const zh = language === "zh";
  if (kind === "pleasantry") {
    return zh ? "不客气！还有什么股票或市场问题想让我分析的吗？" : "You're welcome! Anything else about a stock or the market I can dig into?";
  }
  return zh
    ? "我可以帮你分析个股与大盘：估值、评级、业绩表现、财报要点、最新新闻、同业对比、热门涨跌榜、市场数据等。直接问，比如「英伟达估值如何」「今天涨幅最大的股票」「对比 AMD 和 NVDA」。"
    : "I can analyze stocks and the market: valuation, ratings, performance, earnings, latest news, peer comparison, trending movers, market data, and more. Just ask — e.g. \"how is Nvidia valued?\", \"today's top gainers\", or \"compare AMD and NVDA\".";
}

// ============================================================================
// RECALL — Phase 4a, the origin/freshness subset ONLY ("数据哪来的 / 出处 / 什么时候
// 的" / "where is this from / how recent"). Fires AFTER CHITCHAT inside the
// no-correction block (so it never steals a CORRECT patch), gated on the prior turn
// carrying a data snapshot. Reads the FROZEN snapshot.sources — fetches nothing, runs
// no classifier. Quality/accuracy ("准吗/可靠吗") and computed RECALL ("哪个最高") are
// deferred to Phase 4b. See docs/TURN_KIND_PHASE_4A_PLAN.md §3-4.
//
// Whole-message-anchored (like PLEASANTRY_RE). Over-fire is the only real regression
// direction (Non-goal: "not worse than today"), so the ambiguous high-frequency
// finance words 来源/出处 (收入来源/资金来源/供应链来源) REQUIRE a data-reference anchor
// (数据/这些/上面/刚才/结果…); a bare "来源是什么" is let through to the classifier.
// ============================================================================

/** (A) Explicit provenance/freshness phrasing — self-anchoring, no data anchor needed.
 *  Trailing 呀/呢/吧/啊 mops up common sentence-final particles (zero over-fire risk). */
const PROVENANCE_RE =
  /^(?:这些?|那些?|上面的?|以上|刚才的?)?\s*(?:数据|数字|信息|结果)?\s*(?:(?:是)?从?哪(?:来|儿来|里来)的?|从哪(?:取|拿)的?|什么时候的?|几号的?|多久(?:以前|之前)的?)(?:呀|呢|吧|啊)?[?？。!！]*$|^\s*(?:where (?:is|are|does|did) (?:this data|these numbers|these data|the data|the numbers|this|these|that|it)(?: come)? from|how (?:recent|old|current|up to date) (?:is|are) (?:this data|the data|this|these|that)|when (?:was|were) (?:this data|the data|this|these) (?:fetched|retrieved))[?.!]*$/i;

/** (B) Ambiguous 来源/出处 — REQUIRES a leading data-reference anchor, else "收入来源/
 *  供应链来源" would hijack a genuine finance question. */
const SOURCE_WORD_RE =
  /^(?:这些?|那些?|这个|那个|上面的?|以上|刚才的?|数据|数字|信息|结果)\s*的?\s*(?:数据|信息)?\s*(?:来源|出处)(?:是)?(?:哪里?|什么)?(?:呀|呢|吧|啊)?[?？。!！]*$|^\s*what(?:'?s| is) (?:the |your )?source of (?:this|these|the|that) data\b[?.!]*$/i;

/** True when the turn asks where last turn's data came from / how recent it is. */
export function detectRecall(userMessage: string): boolean {
  const t = userMessage.trim();
  return PROVENANCE_RE.test(t) || SOURCE_WORD_RE.test(t);
}

/** Render one frozen Source as a list line, reading the field that matches its type:
 *  link → article (publish DATE = link.date), model → engine+method (data time =
 *  asOf), data → provider (data time = asOf). Three distinct times are labeled
 *  separately, never collapsed into one "as of". */
export function formatSourceLine(source: Source, zh: boolean): string {
  if (source.type === "link") {
    const label = source.title || source.publisher || source.url;
    const pub = source.publisher && source.title ? `｜${source.publisher}` : "";
    const published = source.date
      ? zh ? `（发布日期 ${source.date}）` : ` (published ${source.date})`
      : "";
    return `- [${label}${pub}](${source.url})${published}`;
  }
  if (source.type === "model") {
    const method = source.method ? (zh ? `（${source.method}）` : ` (${source.method})`) : "";
    return zh
      ? `- ${source.engine}${method} —— 数据时点 ${source.asOf}`
      : `- ${source.engine}${method} — as of ${source.asOf}`;
  }
  return zh
    ? `- ${source.provider} —— 数据时点 ${source.asOf}`
    : `- ${source.provider} — as of ${source.asOf}`;
}

/**
 * Deterministic RECALL answer — reads the FROZEN snapshot.sources (never rebuilds the
 * registry, so asOf can't drift to the follow-up time). The retrieval time
 * (snapshot.capturedAt) is shown once as a header; per-source publish/data times come
 * from each source's own field (link.date / asOf). Empty sources is near-unreachable
 * (buildSnapshot guarantees non-empty validData ⇒ ≥1 source) — kept as defense.
 */
export function answerRecall(snapshot: LastAnswerSnapshot, language: "en" | "zh"): string {
  const zh = language === "zh";
  const sources = snapshot.sources ?? [];
  if (sources.length === 0) {
    return zh
      ? "上一轮未保留可用的来源元数据。"
      : "No usable source metadata was retained from the previous turn.";
  }
  const intro = zh ? "上一轮回答的数据来源：" : "Sources behind the previous answer:";
  const footer = zh
    ? `本轮数据检索时间：${snapshot.capturedAt}`
    : `Data retrieved at: ${snapshot.capturedAt}`;
  const lines = sources.map((s) => formatSourceLine(s, zh)).join("\n");
  return `${intro}\n\n${lines}\n\n${footer}`;
}
