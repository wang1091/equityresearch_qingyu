/**
 * TS detection of a TIME modifier on a fundamentals query — the one dimension where TS, not the
 * LLM, is the authority. PERFORMANCE returns only the LATEST quarter (no date parameter), so any
 * non-latest / multi-period / dated / trailing fundamentals ask is a silent mis-answer; normalize
 * reroutes those to the EARNINGS transcript_qa RAG.
 *
 * WHY ONLY TIME LIVES HERE (LLM/TS boundary — see [[llm-ts-boundary-principle]]):
 *   - TS = compute / pattern: dates, periods, windows. The LLM is unreliable at date reasoning
 *     and empirically routes time-modified fundamentals to PERFORMANCE — so TS is the AUTHORITY,
 *     not a re-judge of a correct LLM call.
 *   - LLM = semantic recognition: whether the target is an operating KPI (members/subscribers/…)
 *     or a qualitative judgment (stable? healthy?) is UNDERSTANDING — the classifier owns it via
 *     prompt rules (METRIC OWNERSHIP). A TS regex second-guessing that semantic call would only
 *     corrupt the cases the LLM already got right (false-positive overrides) — so KPI / qualitative
 *     are deliberately NOT detected here. (If a weak local model under-routes them, the fix is the
 *     prompt, never a regex override.)
 */
import { resolveReturnWindow } from "../../../shared/returnWindow";

// A specific period reference (a quarter label Q# / 第N季度, fiscal YYYY, or a bare year) —
// PERFORMANCE has no date parameter, so it can only ever return the latest quarter, never a named
// one. A RELATIVE "last quarter" (= the latest) is NOT here — that stays PERFORMANCE.
const SPECIFIC_PERIOD_RE = /\bq[1-4]\b|\b(?:fiscal\s+|fy\s*)?20[0-2]\d\b/i;
// Trend / multi-period / trailing framing (incl. bare "history", TTM/LTM/trailing, multi-quarter).
const TREND_RE =
  /\bover the (?:last|past)\b|\byear[\s-]?over[\s-]?year\b|\byoy\b|\bqoq\b|\bover time\b|\btrend\b|\b(?:grown?|grew|growth)\s+over\b|\bhistor(?:y|ical)\b|\bt\.?t\.?m\.?\b|\bl\.?t\.?m\.?\b|\btrailing\b/i;
const TREND_RE_ZH = /历史|趋势|走势|逐年|逐季|同比|环比|过去|多年|这些年|这几季|这几个季度|多季|几个季度|近几季|第[一二三四1-4]季度/;

/** True when a fundamentals query carries a non-latest / multi-period / dated / trailing modifier
 *  PERFORMANCE (latest quarter only, no date param) cannot satisfy → reroute to EARNINGS RAG. */
export function hasHistoricalFundamentalsModifier(query: string): boolean {
  const s = String(query ?? "");
  if (resolveReturnWindow(s) !== null) return true; // last N years/months, since YYYY, YTD, …
  if (SPECIFIC_PERIOD_RE.test(s)) return true;
  return TREND_RE.test(s) || TREND_RE_ZH.test(s);
}
