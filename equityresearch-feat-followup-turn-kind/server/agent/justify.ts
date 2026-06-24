// JUSTIFY (turn_kind Phase 4b-3) — answer "why did you say that / how do you know" about
// last turn's conclusion, deterministically and with ZERO fetch / ZERO LLM. It is a pure
// consumer of the already-committed claim layer (see ./claim.ts): it reads claim.derivation
// (HOW the conclusion was reached) and the evidence handle (WHERE its data is), and NEVER
// calls the planner or re-reads/re-interprets apiData by source. Single-direction:
//   QueryTask → FetchStep → TaskResult → AnswerClaim → JUSTIFY
//
// Two derivation kinds, two honesty levels:
//   - list_extreme: replay the argmax/argmin over the FROZEN view — a real structural "why"
//     (winner vs runner-up over the same field), citing the list's frozen sources.
//   - synthesized: an LLM/fetch answer with no structural derivation → restate + cite, with
//     NO fabricated causal explanation. (No production writer emits synthesized yet — DRILL
//     will in a later slice; the branch is the honest fallback, locked by a unit test.)
import type { ListView } from "@shared/listSnapshot";
import type { ClaimState, ListEmptyDomainDerivation, ListExtremeDerivation, TurnClaim } from "./claim";
import { primaryClaim, resolveClaimEvidence } from "./claim";
import type { LastTurnFrame } from "./conversation";
import type { Source } from "./provenance";
import { formatSourceLine } from "./turnKind";

// ── gate ─────────────────────────────────────────────────────────────────────
// Whole-message meta-questions about OUR prior statement. Tightly anchored so a genuine
// question with a subject ("why did BFLY drop?", "为什么 BFLY 大跌") never fires — that is a
// fresh NEWS question, not a request to justify our claim. Bias to under-fire: a miss falls
// through to normal classification, a false fire would hijack a real question.
const JUSTIFY_RE_ZH =
  /^(?:这|那)?(?:是)?为什么(?:这么|这样)?(?:说|认为|觉得|讲)(?:的|呢)?[?？。!！]*$|^(?:你|您)?(?:是)?(?:怎么|凭什么|根据什么|基于什么|靠什么)(?:这么|这样)?(?:得出|算出|得到|知道|认为|说|判断)(?:的|出来的|这个结论)?[?？。!！]*$|^(?:有)?(?:什么)?(?:依据|根据|理由)(?:是什么|呢)?[?？。!！]*$|^(?:这个?|那个?)?(?:结论|判断|说法|答案)?(?:准|靠谱|可靠|可信)(?:吗|么)?[?？。!！]*$|^怎么(?:得出|算|算出|得到|推出)的?(?:呢)?[?？。!！]*$/;
const JUSTIFY_RE_EN =
  /^why (?:do|would|did) you (?:say|think|conclude) (?:that|so)[?.!]*$|^how do you know(?: that)?[?.!]*$|^how did you (?:get|arrive at|work out|reach) (?:that|this)[?.!]*$|^what(?:'?s| is) (?:the basis|your basis|that based on)[?.!]*$|^says who[?.!]*$|^(?:is|are) (?:that|you) (?:sure|certain|right|accurate|reliable|correct)[?.!]*$|^on what basis[?.!]*$|^what makes you say that[?.!]*$/i;

/** True when the turn asks us to justify last turn's conclusion ("为什么/凭什么/准吗"). */
export function detectJustify(userMessage: string): boolean {
  const t = userMessage.trim();
  return JUSTIFY_RE_ZH.test(t) || JUSTIFY_RE_EN.test(t);
}

// ── deterministic answer ───────────────────────────────────────────────────────
function fieldLabel(field: ListExtremeDerivation["field"], zh: boolean): string {
  if (field === "finalScore") return zh ? "综合评分" : "score";
  return zh ? "涨跌幅" : "price change";
}

function formatValue(field: ListExtremeDerivation["field"], v: number): string {
  return field === "changePercent" ? `${v >= 0 ? "+" : ""}${v.toFixed(2)}%` : v.toFixed(0);
}

/** Finite rows of a view ranked by the derivation's field+direction (frozen list, in-order
 *  tie-break is irrelevant for the explanation). */
interface RankedRow { ticker: string; name?: string; value: number }
/** Replay the comparison: the view's finite rows ranked by field+direction, restricted to
 *  the frozen candidate set when the original ran over a subset (momentum over named picks). */
function rankView(view: ListView, d: ListExtremeDerivation): RankedRow[] {
  const subset = d.candidateTickers ? new Set(d.candidateTickers) : null;
  const rows: RankedRow[] = [];
  for (const item of view.items) {
    const value = item.metrics[d.field];
    if (item.ticker && (!subset || subset.has(item.ticker)) && typeof value === "number" && Number.isFinite(value)) {
      rows.push({ ticker: item.ticker, name: item.name, value });
    }
  }
  return rows.sort((a, b) => (d.direction === "max" ? b.value - a.value : a.value - b.value));
}

function label(name: string | undefined, ticker: string, zh: boolean): string {
  if (!name || name === ticker) return ticker;
  return zh ? `${name}（${ticker}）` : `${name} (${ticker})`;
}

function sourcesBlock(sources: Source[], zh: boolean): string {
  const lines = sources.map((s) => formatSourceLine(s, zh)).join("\n");
  return `\n\n${zh ? "依据：" : "Based on:"}\n${lines}`;
}

/** Structural "why" for a list extreme: replay the comparison over the frozen view. */
function explainListExtreme(claim: TurnClaim, d: ListExtremeDerivation, frame: LastTurnFrame, zh: boolean): string {
  // Fail CLOSED: only replay if the claim's evidence handle still resolves (active_list
  // capturedAt matches). A swapped list may expose the same viewId with DIFFERENT numbers —
  // ranking over it would fabricate a structural "why" over unrelated data. Resolve first.
  const ev = resolveClaimEvidence(claim, frame);
  if (ev.kind !== "resolved") return restate(claim, frame, zh);
  const view = frame.activeList?.list.views.find((v) => v.id === d.viewId);
  if (!view) return restate(claim, frame, zh);
  const ranked = rankView(view, d);
  const winner = ranked[0];
  if (!winner) return restate(claim, frame, zh); // defensive: claim came from this view, so unreachable
  const viewLabel = view.label || view.id;
  const fLabel = fieldLabel(d.field, zh);
  const sources = sourcesBlock(ev.sources, zh);
  const winnerLabel = label(winner.name, winner.ticker, zh);
  const superlative = zh
    ? d.direction === "max" ? "最高" : "最低"
    : d.direction === "max" ? "highest" : "lowest";
  const compare = comparisonClause(winner.value, ranked[1], d, zh);
  return zh
    ? `因为在「${viewLabel}」里按${fLabel}比较这 ${ranked.length} 只，${winnerLabel}的${fLabel}${superlative}：${compare}。这是对榜上现有数字的直接比较，没有额外取数。${sources}`
    : `Because across the ${ranked.length} stocks in "${viewLabel}", ranked by ${fLabel}, ${winnerLabel} has the ${superlative} ${fLabel}: ${compare}. This is a direct comparison of the numbers already on that list — no extra fetch.${sources}`;
}

/** Structural "why" for an empty domain: the requested sign is absent from the WHOLE view, so
 *  the honest answer is "none qualify; the closest is the boundary" — never "X is the most". */
function explainEmptyDomain(claim: TurnClaim, d: ListEmptyDomainDerivation, frame: LastTurnFrame, zh: boolean): string {
  const ev = resolveClaimEvidence(claim, frame); // fail CLOSED, same as list_extreme
  if (ev.kind !== "resolved") return restate(claim, frame, zh);
  const view = frame.activeList?.list.views.find((v) => v.id === d.viewId);
  if (!view) return restate(claim, frame, zh);
  const rows = view.items.filter((i) => i.ticker && typeof i.metrics[d.field] === "number" && Number.isFinite(i.metrics[d.field]));
  const boundary = view.items.find((i) => i.ticker === d.boundaryTicker);
  const boundaryVal = boundary && typeof boundary.metrics[d.field] === "number" ? formatValue(d.field, boundary.metrics[d.field] as number) : "";
  const boundaryLabel = boundary ? label(boundary.name, d.boundaryTicker, zh) : d.boundaryTicker;
  const sources = sourcesBlock(ev.sources, zh);
  const none = d.missingSign === "positive" ? (zh ? "上涨" : "are up") : (zh ? "下跌" : "are down");
  const allSide = d.missingSign === "positive" ? (zh ? "都不为正（≤0）" : "non-positive (≤0)") : (zh ? "都不为负（≥0）" : "non-negative (≥0)");
  return zh
    ? `因为「${view.label || view.id}」里这 ${rows.length} 只的涨跌幅${allSide}，没有${none}的；最接近的是${boundaryLabel}（${boundaryVal}）。这是对榜上现有数字的直接比较，没有额外取数。${sources}`
    : `Because all ${rows.length} stocks in "${view.label || view.id}" have ${allSide} price change — none ${none} — the closest is ${boundaryLabel} (${boundaryVal}). A direct comparison of the numbers already on that list, no extra fetch.${sources}`;
}

/** The winner-vs-runner-up clause, honest about DIRECTION (a min winner is BELOW the
 *  runner-up, not "ahead of") and about TIES (equal values → resolved by list order). */
function comparisonClause(winnerVal: number, runnerUp: { name?: string; ticker: string; value: number } | undefined, d: ListExtremeDerivation, zh: boolean): string {
  const wv = formatValue(d.field, winnerVal);
  if (!runnerUp) return wv;
  const rLabel = label(runnerUp.name, runnerUp.ticker, zh);
  const rv = formatValue(d.field, runnerUp.value);
  if (runnerUp.value === winnerVal) {
    return zh ? `${wv}，与第二名${rLabel}的 ${rv} 并列（按榜单顺序取前者）` : `${wv}, tied with the runner-up ${rLabel} at ${rv} (taking the first by list order)`;
  }
  const rel = d.direction === "max" ? (zh ? "高于" : "ahead of") : (zh ? "低于" : "below");
  return zh ? `${wv}，${rel}第二名${rLabel}的 ${rv}` : `${wv}, ${rel} the runner-up ${rLabel} at ${rv}`;
}

/** Restate / provenance-ground the conclusion, with NO fabricated causal explanation. Handles
 *  both a crisp claim (echo its text + cite) and a synthesized prose answer (text empty →
 *  honest provenance, no prose echo). */
function restate(claim: TurnClaim, frame: LastTurnFrame, zh: boolean): string {
  const ev = resolveClaimEvidence(claim, frame);
  const sources = ev.kind === "resolved" ? sourcesBlock(ev.sources, zh) : "";

  if (claim.text) {
    if (sources) {
      return zh
        ? `这个结论来自上一轮取到的数据：${claim.text}${sources}`
        : `That conclusion comes from the data retrieved last turn: ${claim.text}${sources}`;
    }
    return zh
      ? `${claim.text}（上一轮的分析；未保留可结构化复核的推导步骤）`
      : `${claim.text} (last turn's analysis; no structured derivation was retained to walk through).`;
  }

  // A synthesized prose answer — no one-liner to echo. Ground it in provenance, honestly.
  const subj = claim.subjectTickers.length
    ? (zh ? `关于 ${claim.subjectTickers.join("、")} 的` : ` about ${claim.subjectTickers.join(", ")}`)
    : "";
  if (sources) {
    return zh
      ? `上一轮${subj}回答是综合取到的数据得出的，属于叙述性分析，没有像榜单那样可逐条复核的结构化推导。${sources}`
      : `Last turn's answer${subj} was synthesized from the data retrieved — a narrative analysis, without the step-by-step structured derivation a list comparison has.${sources}`;
  }
  return zh
    ? `上一轮${subj}回答来自当时的分析；未保留可结构化复核的推导步骤。`
    : `Last turn's answer${subj} came from the analysis at the time; no structured derivation was retained to walk through.`;
}

/**
 * Justify last turn's conclusion deterministically. Justifies the PRIMARY claim (a bare
 * "why?" refers to the turn's answer); a future multi-claim turn can route by id.
 */
export function answerJustify(state: ClaimState, frame: LastTurnFrame, language: "en" | "zh"): string {
  const zh = language === "zh";
  const claim = primaryClaim(state);
  switch (claim.derivation.kind) {
    case "list_extreme": return explainListExtreme(claim, claim.derivation, frame, zh);
    case "list_empty_domain": return explainEmptyDomain(claim, claim.derivation, frame, zh);
    case "synthesized": return restate(claim, frame, zh);
  }
}
