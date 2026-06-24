/**
 * Shared live routing-regression harness.
 *
 * Every agent intent (EARNINGS, COMPETITIVE, STOCK_PICKER, …) is chosen by the
 * same classifier, so routing is the natural unified test layer: POST each query
 * to /api/classify-intents-multi and assert the routing tuple
 * (primary_focus, tickers, optional api_params topic).
 *
 * Each module contributes a Suite (a case table). `runSuite` runs one; run.mts
 * runs one or all and aggregates. Deeper per-module quality tests (e.g.
 * competitive-suite.mts force bands) stay separate — this only checks routing.
 *
 * Env: BASE_URL (default http://127.0.0.1:5000), RUNS (default 3, for LLM jitter).
 *
 * LLM & settings: these suites POST to the LIVE server's /api/classify-intents-multi,
 * so the LLM is whatever that server's classifier is configured with — by default
 * prod deepseek-chat @ api.deepseek.com, temperature 0, empty conversationHistory,
 * max_tokens 600, timeout 15s (see server/agent/classifier/index.ts). Point a local
 * model by configuring the server, not this harness.
 */
export type Tier = "guardrail" | "target";

export interface Expect {
  /** Exact primary_focus. */
  primary?: string;
  /** Accept any of these as primary_focus (genuinely ambiguous lenses). */
  primaryOneOf?: string[];
  /** Expected tickers (order-insensitive). */
  tickers: string[];
  /** Optional: assert api_params[primary_focus].topic (e.g. EARNINGS topics). */
  topic?: string;
  /**
   * Optional: assert api_params[primary_focus].year. Guards the LLM-first
   * earnings refactor (A2) — the routing tuple alone does not cover which
   * fiscal period the classifier extracted, so period regressions slip past a
   * topic-only assertion. See docs/LLM_TS_DUPLICATION_INVENTORY.md.
   */
  year?: number;
  /** Optional: assert api_params[primary_focus].quarter (accepts 3 or "q3"). */
  quarter?: number;
  /**
   * Optional: assert required_data contains all of these sources. Guards the
   * multi-intent coerce fix (bug 003) — the routing tuple alone doesn't reveal
   * a dropped co-intent (e.g. VALUATION silently removed from an EARNINGS query).
   */
  requiredIncludes?: string[];
  /**
   * Optional: assert required_data contains NONE of these sources. The mirror of
   * requiredIncludes — guards task-centric capability boundaries that the tuple
   * alone hides, above all "禁止 PERFORMANCE" for operating-KPI / evidence-conflict
   * queries (a wrongly-fanned-out PERFORMANCE(COST) is invisible to primary/topic).
   * See docs/TASK_CENTRIC_QUERY_PLANNING.md §11.
   */
  requiredExcludes?: string[];
  /**
   * Optional: per-source scoped-query content assertions (bug 004). For each
   * source, asserts its api_params query/question text DOES contain every
   * `includes` substring and does NOT contain any `excludes` substring — guards
   * against one intent's clause leaking into another source's scoped query
   * (e.g. an EARNINGS.question that drags in the valuation comparison). Matching
   * is case-insensitive; list both language forms of a term since NEWS/VALUATION
   * queries are translated to English. Only meaningful for free-text sources
   * (EARNINGS.question, NEWS/VALUATION/RUMOR.query).
   */
  scopedQuery?: Record<string, { includes?: string[]; excludes?: string[] }>;
}

/**
 * Optional task-decomposition expectations, consumed ONLY by the Phase 1 shadow
 * measurement (scripts/routing/shadowTasks.ts) — the routing runner ignores it.
 * Source/ticker-set agreement alone can't tell whether the LLM decomposed correctly
 * (two same-source questions wrongly merged still match), so the shadow asserts the
 * expected task COUNT, compiled status, and key entity roles directly.
 */
export interface ShadowExpect {
  /** Expected number of QueryTasks the LLM should decompose this query into. */
  taskCount?: number;
  /** Expected compiled plan status. */
  status?: "ready" | "clarification_required" | "unsupported";
  /** `TICKER:role` pairs that must ALL appear across the emitted tasks' entities. */
  roles?: string[];
}

export interface Case {
  query: string;
  tier: Tier;
  expect: Expect;
  note?: string;
  shadowExpect?: ShadowExpect;
}

export interface Suite {
  /** Module name, e.g. "stockpicker" | "earnings" | "competitive". */
  name: string;
  cases: Case[];
  /** Optional post-classify transform applied before evaluate (e.g. earnings coerce). */
  transform?: (classification: Record<string, any>, query: string) => void;
}

export interface SuiteResult {
  name: string;
  pass: number;
  guardrailFailures: number;
  targetRed: number;
  total: number;
}

/** Thrown when the live classifier is unavailable, so the runner can exit 2 (skip). */
export class ClassifierUnavailable extends Error {}

const RUNS = Math.max(1, Number(process.env.RUNS) || 3);
const BASE_URL = (process.env.BASE_URL || "http://127.0.0.1:5000").replace(/\/+$/, "");

export const normTickers = (t: unknown): string[] =>
  Array.isArray(t)
    ? [...t].map((x) => String(x).toUpperCase().trim()).filter(Boolean).sort()
    : [];

const primaryMatches = (expect: Expect, primary: string): boolean => {
  if (expect.primaryOneOf) return expect.primaryOneOf.includes(primary);
  // primary assertion is opt-in: a case may care only about tickers/required_data
  // (e.g. a metric-ambiguity case asserting just "not PERFORMANCE").
  if (expect.primary === undefined) return true;
  return primary === expect.primary;
};

/** Topic of the primary source's api_params (handles array form). */
export function topicOf(cls: Record<string, any>): string | undefined {
  const primary = cls?.primary_focus;
  const slot = cls?.api_params?.[primary];
  if (Array.isArray(slot)) {
    const topics = [...new Set(slot.map((x) => x?.topic).filter(Boolean))];
    return topics.length === 1 ? topics[0] : topics.length ? topics.join("+") : undefined;
  }
  if (slot && typeof slot === "object" && typeof slot.topic === "string") return slot.topic;
  return undefined;
}

/** Coerce a year/quarter param (number or "q3"/"2025") to a number, else undefined. */
function toPeriodNum(v: unknown): number | undefined {
  if (typeof v === "number") return Number.isFinite(v) ? v : undefined;
  if (typeof v === "string") {
    const n = parseInt(v.replace(/^q/i, "").trim(), 10);
    return Number.isNaN(n) ? undefined : n;
  }
  return undefined;
}

/** year/quarter of the primary source's api_params (handles array form: all must agree). */
export function periodOf(cls: Record<string, any>, key: "year" | "quarter"): number | undefined {
  const primary = cls?.primary_focus;
  const slot = cls?.api_params?.[primary];
  if (Array.isArray(slot)) {
    const vals = [...new Set(slot.map((x) => toPeriodNum(x?.[key])).filter((v) => v !== undefined))];
    return vals.length === 1 ? vals[0] : undefined;
  }
  if (slot && typeof slot === "object") return toPeriodNum(slot[key]);
  return undefined;
}

/** All free-text scoped query/question strings for a source (object or array form). */
export function scopedTextOf(cls: Record<string, any>, source: string): string {
  const slot = cls?.api_params?.[source];
  const slots = Array.isArray(slot) ? slot : slot ? [slot] : [];
  return slots
    .flatMap((s) => [s?.query, s?.question])
    .filter((v): v is string => typeof v === "string")
    .join(" ");
}

/** Pure comparison → null on match, or a human diff string on mismatch. */
function evaluate(expect: Expect, actual: Record<string, any>): string | null {
  const diffs: string[] = [];
  const primary = actual.primary_focus;
  if (!primaryMatches(expect, primary)) {
    const want = expect.primaryOneOf ? expect.primaryOneOf.join("|") : expect.primary;
    diffs.push(`primary ${primary} ≠ ${want}`);
  }
  if (expect.topic !== undefined) {
    const t = topicOf(actual);
    if (t !== expect.topic) diffs.push(`topic ${t ?? "—"} ≠ ${expect.topic}`);
  }
  if (expect.year !== undefined) {
    const y = periodOf(actual, "year");
    if (y !== expect.year) diffs.push(`year ${y ?? "—"} ≠ ${expect.year}`);
  }
  if (expect.quarter !== undefined) {
    const q = periodOf(actual, "quarter");
    if (q !== expect.quarter) diffs.push(`quarter ${q ?? "—"} ≠ ${expect.quarter}`);
  }
  const a = normTickers(actual.tickers);
  const e = [...expect.tickers].map((x) => x.toUpperCase()).sort();
  if (JSON.stringify(a) !== JSON.stringify(e)) diffs.push(`tickers [${a}] ≠ [${e}]`);
  if (expect.requiredIncludes) {
    const rd = Array.isArray(actual.required_data) ? actual.required_data : [];
    const missing = expect.requiredIncludes.filter((s) => !rd.includes(s));
    if (missing.length) diffs.push(`required_data missing [${missing}]`);
  }
  if (expect.requiredExcludes) {
    const rd = Array.isArray(actual.required_data) ? actual.required_data : [];
    const leaked = expect.requiredExcludes.filter((s) => rd.includes(s));
    if (leaked.length) diffs.push(`required_data forbidden [${leaked}]`);
  }
  if (expect.scopedQuery) {
    for (const [source, rule] of Object.entries(expect.scopedQuery)) {
      const text = scopedTextOf(actual, source).toLowerCase();
      for (const sub of rule.includes ?? []) {
        if (!text.includes(sub.toLowerCase())) diffs.push(`${source}.query missing "${sub}"`);
      }
      for (const sub of rule.excludes ?? []) {
        if (text.includes(sub.toLowerCase())) diffs.push(`${source}.query leaked "${sub}"`);
      }
    }
  }
  return diffs.length ? diffs.join("; ") : null;
}

export async function classifyLive(query: string): Promise<Record<string, any>> {
  let res: Response;
  try {
    res = await fetch(`${BASE_URL}/api/classify-intents-multi`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        query,
        conversationHistory: [],
        language: /[一-鿿]/.test(query) ? "zh" : "en",
      }),
    });
  } catch (e) {
    throw new ClassifierUnavailable(e instanceof Error ? e.message : String(e));
  }
  if (res.status >= 500) {
    throw new ClassifierUnavailable(`classify ${res.status}`);
  }
  if (!res.ok) {
    throw new Error(`classify ${res.status}: ${(await res.text()).slice(0, 120)}`);
  }
  return res.json();
}

export const tupleOf = (cls: Record<string, any> | null): string =>
  cls
    ? `${cls.primary_focus}/${topicOf(cls) ?? "—"}/[${normTickers(cls.tickers)}]`
    : "—";

/** Run one suite live. Prints per-case lines; returns a summary. */
export async function runSuite(suite: Suite): Promise<SuiteResult> {
  console.log(`\n🧪 [${suite.name}] routing — LIVE ${BASE_URL} ×${RUNS}\n`);
  let pass = 0;
  let guardrailFailures = 0;
  let targetRed = 0;

  for (const c of suite.cases) {
    const results: string[] = [];
    let last: Record<string, any> | null = null;
    for (let i = 0; i < RUNS; i++) {
      const cls = await classifyLive(c.query); // ClassifierUnavailable bubbles to runner
      if (suite.transform) suite.transform(cls, c.query);
      last = cls;
      results.push(evaluate(c.expect, cls) ?? "OK");
    }
    const allOk = results.every((r) => r === "OK");
    const flaky = new Set(results).size > 1;
    const tuple = tupleOf(last);

    if (allOk && !flaky) {
      pass++;
      console.log(`✅ PASS   [${c.tier}] ${c.query}  →  ${tuple}`);
    } else if (c.tier === "target") {
      targetRed++;
      const want = c.expect.primaryOneOf?.join("|") ?? c.expect.primary;
      const detail = flaky ? `FLAKY: ${[...new Set(results)].join(" | ")}` : results.find((r) => r !== "OK");
      console.log(`🎯 RED    [target]    ${c.query}  →  ${tuple}\n          want ${want}/${c.expect.topic ?? "—"}/[${[...c.expect.tickers].sort()}]\n          ${detail}`);
    } else {
      guardrailFailures++;
      const detail = flaky ? `FLAKY: ${[...new Set(results)].join(" | ")}` : results.find((r) => r !== "OK");
      console.log(`❌ FAIL   [guardrail] ${c.query}  →  ${tuple}\n          ${detail}`);
    }
  }

  console.log(
    `\n— [${suite.name}] guardrails: ${guardrailFailures === 0 ? "ALL GREEN ✅" : `${guardrailFailures} FAILED ❌`}` +
      ` · targets red: ${targetRed}/${suite.cases.filter((c) => c.tier === "target").length} · pass ${pass}/${suite.cases.length}`,
  );

  return { name: suite.name, pass, guardrailFailures, targetRed, total: suite.cases.length };
}
