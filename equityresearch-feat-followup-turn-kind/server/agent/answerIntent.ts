// Answer intent — the single signal that conditions the unified answer contract
// (markdown body + <<<META>>> tail). Replaces the SIMPLE-vs-Brief split that was
// decided by looksLikeInvestmentDecisionQuery alone (index.ts) once the unified
// path is wired. See docs/UNIFIED_ANSWER_CONTRACT_DESIGN.md.
//
// Derived TS-side from signals that already exist today, so the merge preserves
// current behavior: a "decision" query maps to the old Investment-Brief trigger;
// everything else was the SIMPLE path.
import { looksLikeInvestmentDecisionQuery } from "../../shared/earnings";

export type AnswerIntent = "lookup" | "explainer" | "comparison" | "decision";

/** Comparison cue (kept in sync with the direct-card guard in index.ts). */
export const COMPARISON_RE = /对比|比较|vs|versus|compare|和.*对比|分析.*和/i;

export function deriveAnswerIntent(
  userMessage: string,
  classification: { need_api?: boolean; tickers?: string[] },
): AnswerIntent {
  // Decision wins: "should I buy / 值得买吗 / undervalued / 目标价 …"
  if (looksLikeInvestmentDecisionQuery(userMessage)) return "decision";
  // Side-by-side: explicit comparison wording or 2+ tickers in scope.
  if (COMPARISON_RE.test(userMessage) || (classification.tickers?.length || 0) > 1) {
    return "comparison";
  }
  // Concept / general-knowledge — the classifier decided no API call is needed.
  if (classification.need_api === false) return "lookup";
  // Default: a focused data-backed explanation (no buy/sell verdict).
  return "explainer";
}

/** Only decision (and optionally comparison) answers carry a buy/sell verdict. */
export function intentWantsVerdict(intent: AnswerIntent): boolean {
  return intent === "decision";
}
