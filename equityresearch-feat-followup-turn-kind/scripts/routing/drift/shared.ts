/**
 * Shared helpers for the routing-drift tooling (baseline + run).
 *
 * Classifies IN-PROCESS (calls server/agent/classifier directly) rather than
 * over HTTP, so it: (a) needs no running dev server — which currently can't boot
 * under Node 26 — and (b) skips the route's getDeepSeekKey() gate, so a keyless
 * local LLM works. The /api/classify-intents-multi route is a thin wrapper over
 * classifyIntents() returning its result verbatim, so this is faithful to it.
 * Tuple extraction reuses the curated harness helpers so the two never diverge.
 *
 * Requires the CLASSIFIER_LLM_* env on THIS process (the script), e.g.
 *   CLASSIFIER_LLM_BASE_URL=http://127.0.0.1:1234/v1 CLASSIFIER_LLM_MODEL=qwen/qwen3.5-9b
 */
import fs from "node:fs";
import { topicOf, periodOf, normTickers } from "../harness";
import { classifyIntents } from "../../../server/agent/classifier";

export interface CorpusEntry {
  query: string;
  freq: number;
  lang: "en" | "zh";
}

/** The routing decision we snapshot + diff: primary source, topic, tickers, period. */
export interface RoutingTuple {
  primary: string;
  topic: string | null;
  tickers: string[];
  year: number | null;
  quarter: number | null;
}

export interface BaselineEntry extends CorpusEntry {
  tuple: RoutingTuple;
  tupleStr: string;
  /** true when every RUN produced the same tuple (so it's safe to regress on). */
  stable: boolean;
  /** set when classification failed for this query (excluded from drift math). */
  error?: string;
}

const norm = (q: string): string => q.replace(/\s+/g, " ").trim().toLowerCase();
const isZh = (q: string): boolean => /[一-鿿]/.test(q);

// UI-injected noise that must NOT be treated as free-form classifier queries:
//  - the "Smart News Brief" button text bypasses the classifier entirely (the
//    frontend hardcodes primary_focus="NEWS_BRIEF" and posts to /chat-stream),
//    so it never reaches routing in prod — exclude it. (client i18n newsGenerateBrief)
//  - the "[Refine]/[请重新分析]" prefix is a re-analyze marker prepended to a REAL
//    query (and it nests on repeated refines) — strip it, keep the query.
const UI_BRIEF_TEXTS = new Set(["generate smart news brief", "生成智能新闻简报"]);
const REFINE_PREFIX = /^\s*\[(?:Refine|请重新分析)\]\s*/i;

function stripUiPrefix(q: string): string {
  let s = q.trim();
  while (REFINE_PREFIX.test(s)) s = s.replace(REFINE_PREFIX, "").trim();
  return s;
}

/** Read the exported chat_messages JSONL, dedup by normalized text, keep frequency. */
export function loadCorpus(jsonlPath: string): CorpusEntry[] {
  const seen = new Map<string, { query: string; freq: number }>();
  for (const line of fs.readFileSync(jsonlPath, "utf8").split("\n")) {
    const t = line.trim();
    if (!t) continue;
    let q: string;
    try {
      q = String((JSON.parse(t) as { query?: unknown }).query ?? "").trim();
    } catch {
      continue;
    }
    q = stripUiPrefix(q); // [Refine]/[请重新分析] markers → underlying query
    if (!q) continue;
    const k = norm(q);
    if (UI_BRIEF_TEXTS.has(k)) continue; // Smart News Brief button — bypasses classifier
    const cur = seen.get(k);
    if (cur) cur.freq++;
    else seen.set(k, { query: q, freq: 1 }); // keep the first-seen original casing
  }
  return [...seen.values()]
    .map((e) => ({ query: e.query, freq: e.freq, lang: isZh(e.query) ? ("zh" as const) : ("en" as const) }))
    .sort((a, b) => b.freq - a.freq);
}

export function structuredTuple(cls: Record<string, any>): RoutingTuple {
  return {
    primary: cls?.primary_focus ?? "—",
    topic: topicOf(cls) ?? null,
    tickers: normTickers(cls?.tickers),
    year: periodOf(cls, "year") ?? null,
    quarter: periodOf(cls, "quarter") ?? null,
  };
}

/** Stable string form of a tuple — the unit of comparison for drift. */
export const tupleKey = (t: RoutingTuple): string =>
  `${t.primary}/${t.topic ?? "—"}/[${t.tickers.join(",")}]/y${t.year ?? "-"}/q${t.quarter ?? "-"}`;

/** classifyIntents() returns this (not throws) when the LLM is unavailable. */
function isKeywordFallback(cls: Record<string, any>): boolean {
  const r = String(cls?.reasoning ?? "");
  return r.startsWith("Keyword fallback") || r.includes("JSON parse failed") || r.includes("解析失败");
}

/** Classify a query in-process (same language detection as the route). Throws on
 *  keyword-fallback so a down/unconfigured LLM doesn't silently poison results. */
export async function classifyOnce(query: string): Promise<Record<string, any>> {
  const cls = await classifyIntents(query, [], /[一-鿿]/.test(query) ? "zh" : "en");
  if (isKeywordFallback(cls)) {
    throw new Error("classifier fell back to keywords — local LLM unavailable/misconfigured?");
  }
  return cls;
}

/**
 * Classify a query `runs` times and return the majority tuple + whether it was
 * stable (all runs agreed). Throws on classifier failure — callers retry/abort.
 */
export async function classifyMajority(
  query: string,
  runs: number,
): Promise<{ tuple: RoutingTuple; tupleStr: string; stable: boolean }> {
  const seen = new Map<string, { tuple: RoutingTuple; n: number }>();
  for (let i = 0; i < runs; i++) {
    const tuple = structuredTuple(await classifyOnce(query));
    const k = tupleKey(tuple);
    const cur = seen.get(k);
    if (cur) cur.n++;
    else seen.set(k, { tuple, n: 1 });
  }
  const sorted = [...seen.values()].sort((a, b) => b.n - a.n);
  const best = sorted[0];
  return { tuple: best.tuple, tupleStr: tupleKey(best.tuple), stable: sorted.length === 1 };
}
