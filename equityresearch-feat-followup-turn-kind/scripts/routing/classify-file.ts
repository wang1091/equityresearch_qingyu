#!/usr/bin/env tsx
/**
 * Layer B (entity-resolution) classifier tester. Asserts the TICKER dimension
 * (and optionally primary_focus) of the routing decision — "is the right
 * company extracted, and NOT extracted when it shouldn't be?". Layer A (intent
 * routing) lives in the typed harness suites (scripts/routing/run.ts).
 *
 *   # one Layer-B category file
 *   npx tsx scripts/routing/classify-file.ts scripts/routing/cases/common-word-ticker.cases.tsv
 *   # the whole Layer B at once (every *.tsv in the dir)
 *   npx tsx scripts/routing/classify-file.ts scripts/routing/cases
 *   # a single ad-hoc query (no grading, just show the route)
 *   npx tsx scripts/routing/classify-file.ts "block news"
 *
 * LLM & SETTINGS (recorded here, not in docs — docs/ is gitignored):
 *   temperature is ALWAYS 0; every query uses EMPTY conversation history.
 *   LOCAL (default): qwen/qwen3.6-35b-a3b @ LM Studio http://127.0.0.1:1234/v1,
 *                    max_tokens 1200, timeout 180s.
 *   PROD  (DEEPSEEK=1 + --env-file=.env.local): deepseek-chat @ api.deepseek.com,
 *                    max_tokens 600, timeout 15s; LOG_LEVEL=error silences wire logs.
 *   RUNS=N repeats each query (flake detection; default 1).
 * Override CLASSIFIER_LLM_BASE_URL / _MODEL / _API_KEY / _MAX_TOKENS / _TIMEOUT_MS
 * for any other endpoint.
 *
 * Case file format — one per line, TAB-separated; `#` and blank lines ignored:
 *   <query> \t <expect> [\t <note>]
 * <expect> grammar — comma-separated terms, ALL must hold:
 *   TGT            require ticker TGT
 *   GOOGL|GOOG     require any one of these tickers
 *   -TGT           forbid ticker TGT
 *   none           require NO ticker at all
 *   =RATING        require primary_focus = RATING (=A|B for any-of)
 *   ?              ambiguous / informational — printed, never graded
 *   e.g. "AMD,-TGT,=RATING"  or  "-ICE,=NEWS|GENERAL"
 */
import { readFileSync, existsSync, statSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { classifyIntents } from "../../server/agent/classifier";

// Default to the LOCAL model. Set DEEPSEEK=1 (and pass --env-file=.env.local
// for the key) to test prod DeepSeek instead — leaves CLASSIFIER_LLM_* unset so
// the classifier falls through to its DeepSeek default.
if (!process.env.DEEPSEEK) {
  process.env.CLASSIFIER_LLM_BASE_URL ||= "http://127.0.0.1:1234/v1";
  process.env.CLASSIFIER_LLM_MODEL ||= "qwen/qwen3.6-35b-a3b";
  process.env.CLASSIFIER_LLM_API_KEY ||= "lm-studio";
  process.env.CLASSIFIER_LLM_TIMEOUT_MS ||= "180000";
  process.env.CLASSIFIER_LLM_MAX_TOKENS ||= "1200";
}

// The classifier logs via console.log/.warn with emoji prefixes — silence that
// noise so the table stays readable; our own output goes through stdout.write.
const NOISE = /^(ℹ️|✅|🔍|⚠️|🎯|❌ )/;
const realLog = console.log.bind(console);
console.log = (...a: any[]) => { if (!(typeof a[0] === "string" && NOISE.test(a[0]))) realLog(...a); };
console.warn = () => {};
const out = (s: string) => process.stdout.write(s + "\n");

const RUNS = Math.max(1, Number(process.env.RUNS) || 1);
const tickersOf = (c: any): string[] =>
  (Array.isArray(c?.tickers) ? c.tickers : []).map((t: any) => String(t).toUpperCase().trim()).filter(Boolean).sort();
const tup = (c: any) => `${c.primary_focus}/[${tickersOf(c).join(",")}]`;

type Verdict = "PASS" | "FAIL" | "INFO";
function grade(expect: string, c: any): Verdict {
  const e = expect.trim();
  if (!e || e === "?") return "INFO";
  const ts = tickersOf(c);
  const primary = String(c?.primary_focus ?? "").toUpperCase();
  for (const term of e.split(",").map((s) => s.trim()).filter(Boolean)) {
    if (term === "none") {
      if (ts.length !== 0) return "FAIL";                                  // expected no ticker
    } else if (term.startsWith("=")) {
      const anyOf = term.slice(1).split("|").map((s) => s.trim().toUpperCase());
      if (!anyOf.includes(primary)) return "FAIL";                         // wrong primary_focus
    } else if (term.startsWith("-")) {
      if (ts.includes(term.slice(1).toUpperCase())) return "FAIL";         // forbidden ticker present
    } else {
      const anyOf = term.split("|").map((s) => s.trim().toUpperCase());
      if (!anyOf.some((t) => ts.includes(t))) return "FAIL";              // required ticker missing
    }
  }
  return "PASS";
}

interface Row { query: string; expect: string; note: string }

function parseFile(path: string): Row[] {
  return readFileSync(path, "utf8").split("\n")
    .map((l) => l.replace(/\r$/, ""))
    .filter((l) => l.trim() && !l.trimStart().startsWith("#"))
    .map((l) => {
      const [query, expect = "", note = ""] = l.split("\t");
      return { query: query.trim(), expect: expect.trim(), note: note.trim() };
    });
}

/** Resolve the arg into one or more named groups of rows. */
function collect(arg: string | undefined): { label: string; rows: Row[] }[] {
  if (arg && existsSync(arg) && statSync(arg).isDirectory()) {
    return readdirSync(arg).filter((f) => f.endsWith(".tsv")).sort()
      .map((f) => ({ label: f, rows: parseFile(join(arg, f)) }));
  }
  if (arg && existsSync(arg)) return [{ label: arg, rows: parseFile(arg) }];
  return [{ label: "", rows: [{ query: process.argv.slice(2).join(" ").trim(), expect: "", note: "" }] }];
}

(async () => {
  const groups = collect(process.argv[2]);
  const total = groups.reduce((n, g) => n + g.rows.length, 0);
  if (!total || (groups.length === 1 && !groups[0].rows[0]?.query)) {
    out("usage: classify-file.ts <case-file | cases-dir | query...>");
    process.exit(2);
  }

  const modelLabel = process.env.DEEPSEEK ? "deepseek-chat (prod)" : `${process.env.CLASSIFIER_LLM_MODEL} @ ${process.env.CLASSIFIER_LLM_BASE_URL}`;
  out(`model=${modelLabel}  ×${RUNS}  (${total} case${total > 1 ? "s" : ""}${groups.length > 1 ? `, ${groups.length} files` : ""})`);
  const tally = { PASS: 0, FAIL: 0, INFO: 0 };
  const fails: string[] = [];

  for (const g of groups) {
    if (g.label) out(`\n## ${g.label}`);
    for (const r of g.rows) {
      const seen = new Set<string>();
      let last: any = null;
      for (let i = 0; i < RUNS; i++) { last = await classifyIntents(r.query, [], /[一-鿿]/.test(r.query) ? "zh" : "en"); seen.add(tup(last)); }
      const v = grade(r.expect, last);
      tally[v]++;
      const flaky = seen.size > 1 ? "  ⚠️FLAKY:" + [...seen].join("|") : "";
      const icon = v === "PASS" ? "✅" : v === "FAIL" ? "❌" : "·";
      out(`${icon} ${r.query.padEnd(36)} → ${tup(last).padEnd(22)} ${v === "INFO" ? "(info)" : "want " + r.expect}${flaky}`);
      if (v === "FAIL") fails.push(`   [${g.label}] ${r.query}  →  ${tup(last)}   (want ${r.expect})${r.note ? "  — " + r.note : ""}`);
    }
  }

  out(`\n— PASS ${tally.PASS} · FAIL ${tally.FAIL} · INFO ${tally.INFO} / ${total}`);
  if (fails.length) { out("\nFAILURES:"); fails.forEach(out); }
  process.exit(tally.FAIL === 0 ? 0 : 1);
})();
