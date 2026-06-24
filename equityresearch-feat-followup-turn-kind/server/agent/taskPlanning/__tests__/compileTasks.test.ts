import { describe, it, expect } from "vitest";
import { compileTasks } from "../compileTasks";
import { isSourceSupported, capabilitiesFor } from "../capabilityRegistry";
import type { MetricFamily, RawTaskCandidate } from "../types";

// These tests feed hand-authored RawTaskCandidate[] — what the LLM (prod 9B) would
// emit for each row of the doc §11 matrix — and assert the DETERMINISTIC TS pipeline
// (normalize → validate → compile → derive). No LLM, no fetch. This is exactly the
// L2/L3 layer the Phase 0 routing suite marked "DEFERRED": the routing tuple cannot
// see task COUNT, clarification status, or per-task roles, so the assertions that
// matter for task-centric live here, against the compiler.

const raw = (r: Partial<RawTaskCandidate> & Pick<RawTaskCandidate, "question" | "entities" | "metric">): RawTaskCandidate => r;

describe("compileTasks — §11 matrix L2/L3 (deterministic, no LLM)", () => {
  it("row 1: single operating-KPI lookup (Costco's own call) → EARNINGS, never PERFORMANCE", () => {
    const plan = compileTasks([
      raw({
        question: "How many paid Costco memberships are there?",
        entities: [{ ticker: "COST", role: "subject" }],
        metric: { family: "operating_kpi", name: "paid_memberships" },
        evidenceConstraints: [{ kind: "document_type", value: "earnings_call" }],
      }),
    ]);
    expect(plan.status).toBe("ready");
    expect(plan.requiredData).toEqual(["EARNINGS"]);
    expect(plan.requiredData).not.toContain("PERFORMANCE");
    expect(plan.fetch[0].params.topic).toBe("transcript_qa");
    expect(plan.subjectTickers).toEqual(["COST"]);
  });

  it("row 2: evidence/subject CONFLICT (Tesla call → Costco members) → clarification, no fetch", () => {
    const plan = compileTasks([
      raw({
        question: "How many paid Costco memberships are there?",
        entities: [
          { ticker: "COST", role: "subject" },
          { ticker: "TSLA", role: "evidence_source" },
        ],
        metric: { family: "operating_kpi", name: "paid_memberships" },
        evidenceRelation: "unrelated",
      }),
    ]);
    expect(plan.status).toBe("clarification_required");
    expect(plan.tasks[0].issues.map((i) => i.code)).toContain("evidence_subject_mismatch");
    expect(plan.fetch).toHaveLength(0); // do not fetch what we must clarify first
  });

  it("row 2 robustness: even a mislabeled read_through can't prove a direct own fact", () => {
    const plan = compileTasks([
      raw({
        question: "How many paid Costco memberships are there?",
        entities: [
          { ticker: "COST", role: "subject" },
          { ticker: "TSLA", role: "evidence_source" },
        ],
        metric: { family: "operating_kpi" },
        evidenceRelation: "read_through", // LLM mislabel — direct-own-fact gate still blocks
      }),
    ]);
    expect(plan.status).toBe("clarification_required");
    expect(plan.tasks[0].issues.map((i) => i.code)).toContain("evidence_subject_mismatch");
  });

  it("row 6: LEGAL cross-company read-through (NVDA commentary → how is AMD positioned) → ready", () => {
    const plan = compileTasks([
      raw({
        question: "How is AMD positioned competitively?",
        entities: [
          { ticker: "AMD", role: "subject" },
          { ticker: "NVDA", role: "evidence_source" },
        ],
        metric: { family: "management_commentary" },
        evidenceRelation: "commentary_about_subject",
      }),
    ]);
    expect(plan.status).toBe("ready");
    expect(plan.tasks[0].issues).toHaveLength(0);
    expect(plan.requiredData).toEqual(["EARNINGS"]);
    // #1: retrieve from the EVIDENCE company (NVDA's call), not the subject AMD…
    expect(plan.fetch[0].params.tickers).toEqual(["NVDA"]);
    // …while the top-level summary still names the subject the user asked about.
    expect(plan.subjectTickers).toEqual(["AMD"]);
  });

  it("row 7: external call cannot substitute AMD's reported revenue → clarification", () => {
    const plan = compileTasks([
      raw({
        question: "What was AMD's reported revenue?",
        entities: [
          { ticker: "AMD", role: "subject" },
          { ticker: "NVDA", role: "evidence_source" },
        ],
        metric: { family: "statement_metric", name: "revenue" },
        evidenceRelation: "read_through",
      }),
    ]);
    expect(plan.status).toBe("clarification_required");
    expect(plan.tasks[0].issues.map((i) => i.code)).toContain("evidence_subject_mismatch");
  });

  it("row 3: true double question, both → EARNINGS, two distinct taskIds", () => {
    const plan = compileTasks([
      raw({
        question: "Summarize Tesla's latest earnings call.",
        entities: [{ ticker: "TSLA", role: "subject" }],
        metric: { family: "management_commentary" },
        operation: "summarize",
      }),
      raw({
        question: "How many paid Costco memberships are there?",
        entities: [{ ticker: "COST", role: "subject" }],
        metric: { family: "operating_kpi", name: "paid_memberships" },
      }),
    ]);
    expect(plan.status).toBe("ready");
    expect(plan.tasks.map((t) => t.id)).toEqual(["task-1", "task-2"]);
    expect(plan.requiredData).toEqual(["EARNINGS"]); // one source, two tasks
    expect(new Set(plan.fetch.map((s) => s.taskId))).toEqual(new Set(["task-1", "task-2"]));
    expect(plan.subjectTickers.sort()).toEqual(["COST", "TSLA"]);
  });

  it("row 4: same subject, two metrics → split by capability (PERFORMANCE + EARNINGS), single subject", () => {
    const plan = compileTasks([
      raw({
        question: "What is Costco's revenue?",
        entities: [{ ticker: "COST", role: "subject" }],
        metric: { family: "statement_metric", name: "revenue" },
      }),
      raw({
        question: "What is Costco's member count?",
        entities: [{ ticker: "COST", role: "subject" }],
        metric: { family: "operating_kpi", name: "paid_memberships" },
      }),
    ]);
    expect(plan.status).toBe("ready");
    expect(new Set(plan.requiredData)).toEqual(new Set(["PERFORMANCE", "EARNINGS"]));
    expect(plan.subjectTickers).toEqual(["COST"]); // deduped — not two companies
    expect(plan.fetch.find((s) => s.source === "PERFORMANCE")?.taskId).toBe("task-1");
    expect(plan.fetch.find((s) => s.source === "EARNINGS")?.taskId).toBe("task-2");
  });

  it("row 5: mentioned entity is not a fetch subject (Tesla mentioned Costco)", () => {
    const plan = compileTasks([
      raw({
        question: "What did Tesla say about Costco?",
        entities: [
          { ticker: "TSLA", role: "subject" },
          { ticker: "COST", role: "mentioned" },
        ],
        metric: { family: "management_commentary" },
        operation: "attribute",
      }),
    ]);
    expect(plan.status).toBe("ready");
    expect(plan.subjectTickers).toEqual(["TSLA"]); // COST excluded (mentioned, §13.4)
    expect(plan.requiredData).toEqual(["EARNINGS"]);
    expect(plan.requiredData).not.toContain("PERFORMANCE");
    expect(plan.fetch.every((s) => (s.params.tickers as string[]).includes("TSLA"))).toBe(true);
    expect(plan.fetch.some((s) => (s.params.tickers as string[]).includes("COST"))).toBe(false);
  });

  it("row 9: ambiguous metric (bare 'users') → clarification, no fetch", () => {
    const plan = compileTasks([
      raw({
        question: "How many users does Apple have?",
        entities: [{ ticker: "AAPL", role: "subject" }],
        metric: { family: "unknown", name: "users" }, // LLM unsure of caliber
      }),
    ]);
    expect(plan.status).toBe("clarification_required");
    expect(plan.tasks[0].issues.map((i) => i.code)).toContain("ambiguous_metric");
    expect(plan.fetch).toHaveLength(0);
  });

  it("§5.4: comparison is ONE task, not two lookups; peers count as subjectTickers", () => {
    const plan = compileTasks([
      raw({
        question: "Compare AMD and NVIDIA gross margins.",
        entities: [
          { ticker: "AMD", role: "subject" },
          { ticker: "NVDA", role: "peer" },
        ],
        metric: { family: "statement_metric", name: "gross_margin" },
        operation: "compare",
      }),
    ]);
    expect(plan.status).toBe("ready");
    expect(plan.tasks).toHaveLength(1);
    expect(plan.tasks[0].operation).toBe("compare");
    expect(plan.requiredData).toEqual(["PERFORMANCE"]);
    expect(plan.subjectTickers.sort()).toEqual(["AMD", "NVDA"]);
  });

  it("TS structural derivation wins over a contradictory lookup hint when a peer exists", () => {
    const plan = compileTasks([
      raw({
        question: "Compare AMD and NVIDIA gross margins.",
        entities: [
          { ticker: "AMD", role: "subject" },
          { ticker: "NVDA", role: "peer" },
        ],
        metric: { family: "statement_metric", name: "gross_margin" },
        operation: "lookup",
      }),
    ]);
    expect(plan.tasks[0].operation).toBe("compare");
  });

  it("comparison constrained to external commentary retrieves the evidence company", () => {
    const plan = compileTasks([
      raw({
        question: "Based on NVIDIA commentary, compare AMD and Intel positioning.",
        entities: [
          { ticker: "AMD", role: "subject" },
          { ticker: "INTC", role: "peer" },
          { ticker: "NVDA", role: "evidence_source" },
        ],
        metric: { family: "management_commentary" },
        operation: "compare",
        evidenceConstraints: [{ kind: "company", value: "NVDA" }],
        evidenceRelation: "comparison",
      }),
    ]);
    expect(plan.status).toBe("ready");
    expect(plan.fetch[0].params.tickers).toEqual(["NVDA"]);
    expect(plan.subjectTickers).toEqual(["AMD", "INTC"]);
  });

  it("same_subject relation: a company's OWN call as evidence is never a conflict", () => {
    const plan = compileTasks([
      raw({
        question: "How many paid Costco memberships are there?",
        entities: [
          { ticker: "COST", role: "subject" },
          { ticker: "COST", role: "evidence_source" },
        ],
        metric: { family: "operating_kpi", name: "paid_memberships" },
        evidenceRelation: "same_subject",
      }),
    ]);
    expect(plan.status).toBe("ready");
    expect(plan.tasks[0].issues).toHaveLength(0);
  });

  it("missing subject → ambiguous_subject (blocking)", () => {
    const plan = compileTasks([
      raw({ question: "How many members?", entities: [], metric: { family: "operating_kpi" } }),
    ]);
    expect(plan.status).toBe("clarification_required");
    expect(plan.tasks[0].issues.map((i) => i.code)).toContain("ambiguous_subject");
  });

  it("#3: evidenceConstraints (10-K) are retained in the FetchStep logical params", () => {
    const plan = compileTasks([
      raw({
        question: "How many Costco members per the 10-K?",
        entities: [{ ticker: "COST", role: "subject" }],
        metric: { family: "operating_kpi", name: "paid_memberships" },
        evidenceConstraints: [{ kind: "document_type", value: "10-K" }],
      }),
    ]);
    expect(plan.status).toBe("ready");
    expect(plan.fetch[0].params.evidenceConstraints).toEqual([{ kind: "document_type", value: "10-K" }]);
    expect(plan.fetch[0].params.question).toBe("How many Costco members per the 10-K?");
  });

  it("cross-company evidence constraint without an evidence_source fails closed", () => {
    const plan = compileTasks([
      raw({
        question: "How is AMD positioned according to NVIDIA?",
        entities: [{ ticker: "AMD", role: "subject" }],
        metric: { family: "management_commentary" },
        evidenceConstraints: [{ kind: "company", value: "NVDA" }],
        evidenceRelation: "commentary_about_subject",
      }),
    ]);
    expect(plan.status).toBe("clarification_required");
    expect(plan.tasks[0].issues.map((i) => i.code)).toContain("evidence_subject_mismatch");
    expect(plan.fetch).toHaveLength(0);
  });

  it("same-company evidence constraint can be represented by the subject entity", () => {
    const plan = compileTasks([
      raw({
        question: "How many Costco members according to Costco?",
        entities: [{ ticker: "COST", role: "subject" }],
        metric: { family: "operating_kpi", name: "paid_memberships" },
        evidenceConstraints: [{ kind: "company", value: "COST" }],
      }),
    ]);
    expect(plan.status).toBe("ready");
    expect(plan.fetch[0].params.tickers).toEqual(["COST"]);
  });

  it("#4: valid explicit period flows into params; quarter→year normalized", () => {
    const plan = compileTasks([
      raw({
        question: "Costco Q2 2024 revenue",
        entities: [{ ticker: "COST", role: "subject" }],
        metric: { family: "statement_metric", name: "revenue" },
        explicitPeriod: { year: 2024, quarter: 2 },
      }),
    ]);
    expect(plan.status).toBe("ready");
    expect(plan.fetch[0].params.period).toEqual({ kind: "quarter", year: 2024, quarter: 2 });
  });

  it("#4: invalid explicit period (Q5) → invalid_period, NOT ready, no fetch, no silent downgrade", () => {
    const plan = compileTasks([
      raw({
        question: "Costco Q5 revenue",
        entities: [{ ticker: "COST", role: "subject" }],
        metric: { family: "statement_metric", name: "revenue" },
        explicitPeriod: { quarter: 5 },
      }),
    ]);
    expect(plan.status).not.toBe("ready");
    expect(plan.tasks[0].issues.map((i) => i.code)).toContain("invalid_period");
    expect(plan.tasks[0].period).toBeUndefined(); // not coerced to latest
    expect(plan.fetch).toHaveLength(0);
  });

  it("#2: unregistered family (market_metric) → unsupported, no fetch", () => {
    const plan = compileTasks([
      raw({
        question: "What is NVDA's price?",
        entities: [{ ticker: "NVDA", role: "subject" }],
        metric: { family: "market_metric", name: "price" },
      }),
    ]);
    expect(plan.status).toBe("unsupported");
    expect(plan.tasks[0].issues.map((i) => i.code)).toContain("unsupported_metric_source");
    expect(plan.fetch).toHaveLength(0);
  });

  it("runtime schema rejects malformed required fields instead of throwing or fetching", () => {
    for (const [candidate, expectedCode] of [
      [{ question: "q", metric: { family: "operating_kpi" } }, "invalid_candidate"],
      [{ question: "q", entities: [{ ticker: 123, role: "subject" }], metric: { family: "operating_kpi" } }, "invalid_candidate"],
      [{ question: "   ", entities: [{ ticker: "COST", role: "subject" }], metric: { family: "operating_kpi" } }, "invalid_candidate"],
      [{ question: "q", entities: [{ ticker: "   ", role: "subject" }], metric: { family: "operating_kpi" } }, "invalid_candidate"],
      [{
        question: "q",
        entities: [{ ticker: "COST", role: "subject" }],
        metric: { family: "operating_kpi" },
        explicitPeriod: "Q5",
      }, "invalid_period"],
    ]) {
      const plan = compileTasks([candidate]);
      expect(plan.status).toBe("clarification_required");
      expect(plan.tasks[0].issues.map((i) => i.code)).toEqual([expectedCode]);
      expect(plan.fetch).toHaveLength(0);
    }
  });

  it("empty or non-array candidate collections fail closed", () => {
    for (const candidates of [[], null, {}]) {
      const plan = compileTasks(candidates);
      expect(plan.status).toBe("clarification_required");
      expect(plan.tasks[0].issues.map((i) => i.code)).toContain("invalid_candidate");
      expect(plan.fetch).toHaveLength(0);
    }
  });
});

describe("capabilityRegistry — deterministic ownership (§4.2 / §8.1)", () => {
  it("operating_kpi is EARNINGS/transcript_qa, NEVER PERFORMANCE", () => {
    expect(isSourceSupported("operating_kpi", "EARNINGS")).toBe(true);
    expect(isSourceSupported("operating_kpi", "PERFORMANCE")).toBe(false);
    expect(capabilitiesFor("operating_kpi")[0].topic).toBe("transcript_qa");
  });

  it("statement_metric is PERFORMANCE", () => {
    expect(isSourceSupported("statement_metric", "PERFORMANCE")).toBe(true);
    expect(isSourceSupported("statement_metric", "EARNINGS")).toBe(false);
  });

  it("registered v1 families resolve to a source; unregistered ones fail closed", () => {
    for (const family of ["operating_kpi", "statement_metric", "management_commentary"] as MetricFamily[]) {
      expect(capabilitiesFor(family).length).toBeGreaterThan(0);
    }
    // Deliberately narrow (doc §392): these have no param path yet → no capability.
    for (const family of ["market_metric", "valuation_metric", "news_event"] as MetricFamily[]) {
      expect(capabilitiesFor(family)).toHaveLength(0);
    }
  });
});
