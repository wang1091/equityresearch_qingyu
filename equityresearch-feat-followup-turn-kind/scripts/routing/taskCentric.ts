/** Task-centric routing cases (Phase 0 regression corpus). Run:
 *   npx tsx scripts/routing/run.ts taskcentric
 *
 * This is the Phase 0 "allow-fail" baseline for docs/TASK_CENTRIC_QUERY_PLANNING.md.
 * It encodes the §11 test matrix: the failures it surfaces ARE the structural gap
 * the task-centric plan exists to close (multi-mention over-fragmentation, operating
 * KPIs wrongly homed in PERFORMANCE, evidence/subject conflicts silently fanned into
 * two source calls, mentioned entities triggering their own fetch). Reds here are
 * EXPECTED today and are the measurable baseline — every case is tier:"target" so a
 * red never breaks the runner; cases turn green as Phase 0.5 / task semantics land.
 *
 * WHAT THIS LAYER CAN SEE — the routing tuple only (primary_focus, tickers, topic,
 * required_data via requiredIncludes/requiredExcludes, scopedQuery). It CANNOT see
 * task COUNT, taskIds, per-task entity roles, or clarification status — those do not
 * exist in ClassificationResult yet. The deep assertions from §11 (two taskIds for a
 * true double-question, clarification_required for an evidence/subject conflict,
 * subject-vs-mentioned role) are therefore DEFERRED to deterministic L2–L5 unit tests
 * against the Phase 2 task compiler/validator (doc §1022). Here we assert only the
 * observable symptom of each gap and spell out the deferred part in `note`.
 *
 * KEY OBSERVABLE PROXY — `requiredExcludes: ["PERFORMANCE"]`. A wrongly-fanned-out
 * PERFORMANCE(COST) is invisible to primary/topic/tickers; the new requiredExcludes
 * assertion (harness.ts) is what makes "禁止 PERFORMANCE" testable.
 *
 * HELD-OUT, NOT prompt few-shots ([[routing-multiintent-suite]]): these queries are
 * paraphrases / alt tickers vs the worked Q/A examples in classifier/prompt.ts. They
 * intentionally exercise prompt RULES (e.g. line 120 "operating KPIs → EARNINGS") to
 * test generalization, not copy a few-shot answer key. Before adding a case, grep
 * prompt.ts for the query and reword if it matches an example pair.
 */
import type { Suite } from "./harness";

export const taskCentricSuite: Suite = {
  name: "taskcentric",
  cases: [
    // ── §11 row 1 — single operating-KPI lookup; evidence is the company's OWN call.
    // Gap: members is not a statement field → must NOT route to PERFORMANCE.
    { query: "based on Costco earnings call, number of Costco members", tier: "target",
      expect: { primary: "EARNINGS", tickers: ["COST"], topic: "transcript_qa", requiredExcludes: ["PERFORMANCE"] },
      shadowExpect: { taskCount: 1, status: "ready", roles: ["COST:subject"] },
      note: "operating KPI (members) → EARNINGS/transcript_qa; 禁止 PERFORMANCE" },

    // Held-out paraphrase of row 1 (no 'earnings call' evidence clause).
    { query: "how many paid members does Costco have", tier: "target",
      expect: { primary: "EARNINGS", tickers: ["COST"], topic: "transcript_qa", requiredExcludes: ["PERFORMANCE"] },
      shadowExpect: { taskCount: 1, status: "ready", roles: ["COST:subject"] },
      note: "KPI generalization, plain phrasing" },

    // Generalization to a different KPI + ticker (subscribers / NFLX).
    { query: "how many subscribers does Netflix have", tier: "target",
      expect: { primary: "EARNINGS", tickers: ["NFLX"], topic: "transcript_qa", requiredExcludes: ["PERFORMANCE"] },
      shadowExpect: { taskCount: 1, status: "ready", roles: ["NFLX:subject"] },
      note: "KPI rule must generalize beyond Costco/members" },

    // CN variant of the KPI rule.
    { query: "好市多有多少会员", tier: "target",
      expect: { primary: "EARNINGS", tickers: ["COST"], topic: "transcript_qa", requiredExcludes: ["PERFORMANCE"] },
      shadowExpect: { taskCount: 1, status: "ready", roles: ["COST:subject"] },
      note: "CN: 会员数 KPI → EARNINGS; alias 好市多→COST" },

    // Typo + missing punctuation variant (memebers, no comma).
    { query: "based on costco earnings call number of costco memebers", tier: "target",
      expect: { primary: "EARNINGS", tickers: ["COST"], topic: "transcript_qa", requiredExcludes: ["PERFORMANCE"] },
      shadowExpect: { taskCount: 1, status: "ready", roles: ["COST:subject"] },
      note: "typo/no-punct robustness of the KPI rule" },

    // ── §11 row 8 — document-constrained KPI. Observable part = KPI→EARNINGS, 禁止
    // PERFORMANCE. DEFERRED: the 10-K evidenceConstraint must be preserved (no
    // routing-tuple field carries it yet).
    { query: "according to Costco's 10-K, how many members does Costco have", tier: "target",
      expect: { primary: "EARNINGS", tickers: ["COST"], requiredExcludes: ["PERFORMANCE"] },
      shadowExpect: { taskCount: 1, status: "ready", roles: ["COST:subject"] },
      note: "DEFERRED: document_type=10-K evidenceConstraint (L2 task-validator)" },

    // ── §11 row 2 — evidence/subject CONFLICT (Tesla's call cannot prove Costco's
    // own KPI). The bug fans this into EARNINGS(TSLA)+PERFORMANCE(COST). Observable
    // proxy = 禁止 PERFORMANCE (no Costco performance fan-out). DEFERRED: the real
    // target is status=clarification_required — not expressible in the routing tuple.
    { query: "based on Tesla earnings call, number of Costco members", tier: "target",
      expect: { primary: "EARNINGS", tickers: ["COST", "TSLA"], requiredExcludes: ["PERFORMANCE"] },
      shadowExpect: { taskCount: 1, status: "clarification_required", roles: ["COST:subject", "TSLA:evidence_source"] },
      note: "DEFERRED: evidence_subject_mismatch → clarification_required (L2); here only assert no PERFORMANCE(COST) fan-out" },

    // ── §11 row 7 — external company's call cannot substitute AMD's reported revenue.
    // AMD revenue IS a statement_metric, so PERFORMANCE is the right SOURCE — the
    // conflict is the NVDA-call evidence constraint, invisible to the tuple. We can
    // only anchor the entities here. DEFERRED: conflict/clarification at L2.
    { query: "based on NVIDIA's call, what was AMD's reported revenue", tier: "target",
      expect: { primaryOneOf: ["PERFORMANCE", "EARNINGS"], tickers: ["AMD", "NVDA"] },
      shadowExpect: { taskCount: 1, status: "clarification_required", roles: ["AMD:subject", "NVDA:evidence_source"] },
      note: "DEFERRED: evidence(NVDA) vs subject(AMD) statement fact = conflict/clarify (L2 only)" },

    // ── §11 row 6 — LEGAL cross-company read-through (the contrast to rows 2/7).
    // NVDA management commenting on AMD's positioning is answerable; must NOT be
    // flagged as a conflict or have a co-intent dropped.
    { query: "based on NVIDIA commentary, how is AMD positioned", tier: "target",
      expect: { primaryOneOf: ["EARNINGS", "COMPETITIVE"], tickers: ["AMD", "NVDA"] },
      shadowExpect: { taskCount: 1, status: "ready", roles: ["AMD:subject", "NVDA:evidence_source"] },
      note: "legal read-through: evidence=NVDA, subject=AMD — must not be dropped/conflicted" },

    // ── §11 row 4 — same subject, two metrics, two capabilities. revenue→PERFORMANCE,
    // members→EARNINGS. Both sources are CORRECT here (different metrics) — the gap is
    // splitting by metric, not collapsing to one source or fanning by ticker.
    { query: "Costco revenue and member count", tier: "target",
      expect: { primaryOneOf: ["PERFORMANCE", "EARNINGS"], tickers: ["COST"],
        requiredIncludes: ["PERFORMANCE", "EARNINGS"] },
      shadowExpect: { taskCount: 2, status: "ready", roles: ["COST:subject"] },
      note: "metric split: statement→PERFORMANCE + KPI→EARNINGS, single subject COST" },

    // ── §11 row 10 — same as row 4, comparison-ish phrasing.
    { query: "Costco members vs revenue growth", tier: "target",
      expect: { primaryOneOf: ["PERFORMANCE", "EARNINGS"], tickers: ["COST"],
        requiredIncludes: ["PERFORMANCE", "EARNINGS"] },
      shadowExpect: { taskCount: 2, status: "ready", roles: ["COST:subject"] },
      note: "shared-subject KPI + statement metric must split, not fragment by ticker (LLM under-decomposes this — see shadow)" },

    // ── §11 row 5 — mentioned entity is NOT a fetch subject. Only TSLA is queried.
    // Desired top-level tickers = [TSLA] (§13.4: pure-mentioned excluded). Likely red
    // today (COST leaks into tickers) — that red IS the gap. 禁止 Costco PERFORMANCE.
    { query: "Tesla mentioned Costco in the call, what did Tesla say", tier: "target",
      expect: { primary: "EARNINGS", tickers: ["TSLA"], topic: "transcript_qa", requiredExcludes: ["PERFORMANCE"] },
      shadowExpect: { taskCount: 1, status: "ready", roles: ["TSLA:subject", "COST:mentioned"] },
      note: "attribution: subject=TSLA, COST=mentioned (no COST fetch, not in top-level tickers)" },

    // ── §11 row 3 — TRUE double question, both map to EARNINGS. Observable: both
    // tickers present, EARNINGS required, no PERFORMANCE. DEFERRED: two distinct
    // taskIds with two scoped questions (single-source task identity, L4).
    { query: "summarize Tesla's call and give me Costco's member count", tier: "target",
      expect: { primary: "EARNINGS", tickers: ["COST", "TSLA"],
        requiredIncludes: ["EARNINGS"], requiredExcludes: ["PERFORMANCE"] },
      shadowExpect: { taskCount: 2, status: "ready", roles: ["TSLA:subject", "COST:subject"] },
      note: "DEFERRED: 2 taskIds / 2 scoped questions over one EARNINGS source (L4)" },

    // ── §11 row 9 — metric AMBIGUITY. Bare "users" is under-specified (active devices
    // / subscribers / accounts). Per Phase 0.5 §637 bare 'users' must not auto-reroute;
    // it is NOT a statement metric → 禁止 PERFORMANCE. DEFERRED: ambiguous_metric →
    // clarification (L2). Anchor only the ticker + no-PERFORMANCE here.
    { query: "how many users does Apple have", tier: "target",
      expect: { tickers: ["AAPL"], requiredExcludes: ["PERFORMANCE"] },
      // status intentionally unasserted: design wants ambiguous_metric→clarify, but
      // DeepSeek confidently tags 'users' as operating_kpi (ready). Roles/count only.
      shadowExpect: { taskCount: 1, roles: ["AAPL:subject"] },
      note: "DEFERRED: ambiguous_metric (users=?) → clarify (L2); proxy = not PERFORMANCE" },
  ],
};
