#!/usr/bin/env tsx
/**
 * Phase 3 — generate the routing baseline snapshot from the production corpus.
 *
 * Reads the deduped chat_messages corpus, classifies every unique query through
 * the LIVE classifier (whatever the running dev server is configured with — set
 * it to LM Studio for a free local run), and writes the routing tuple per query.
 * This is the "current behavior" golden file that routing:drift:run diffs against.
 *
 * RESUMABLE: re-running picks up where it left off (skips already-done queries,
 * retries previously-errored ones) and flushes every FLUSH_EVERY queries, so a
 * multi-hour local-LLM run can be interrupted/backgrounded safely.
 *
 * Classifies in-process (no dev server needed) — set the local LLM on THIS
 * process. With LM Studio running (model loaded), e.g.:
 *   CLASSIFIER_LLM_BASE_URL=http://127.0.0.1:1234/v1 \
 *   CLASSIFIER_LLM_MODEL=qwen/qwen3.5-9b \
 *   CLASSIFIER_LLM_TIMEOUT_MS=120000 CLASSIFIER_LLM_MAX_TOKENS=1200 \
 *   npm run routing:drift:baseline
 *
 * Env: DRIFT_CORPUS, DRIFT_BASELINE, RUNS (default 1), FLUSH_EVERY (default 20).
 */
import fs from "node:fs";
import path from "node:path";
import { loadCorpus, classifyMajority, type BaselineEntry } from "./shared";

const INPUT = process.env.DRIFT_CORPUS || "scripts/baselines/chat_queries.local.jsonl";
const OUT = process.env.DRIFT_BASELINE || "scripts/baselines/routing-corpus.baseline.local.json";
const RUNS = Math.max(1, Number(process.env.RUNS) || 1);
const FLUSH_EVERY = Math.max(1, Number(process.env.FLUSH_EVERY) || 20);
const MAX_CONSECUTIVE_FAILS = 8; // systemic outage → abort (vs one transient timeout)

function loadExisting(): Map<string, BaselineEntry> {
  if (!fs.existsSync(OUT)) return new Map();
  try {
    const arr = JSON.parse(fs.readFileSync(OUT, "utf8")) as BaselineEntry[];
    return new Map(arr.map((e) => [e.query, e]));
  } catch {
    return new Map();
  }
}

function save(map: Map<string, BaselineEntry>): void {
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify([...map.values()], null, 2));
}

function summarize(map: Map<string, BaselineEntry>): void {
  const all = [...map.values()];
  const stable = all.filter((e) => e.stable && !e.error).length;
  const errors = all.filter((e) => e.error).length;
  const dist = new Map<string, number>();
  for (const e of all) dist.set(e.tuple.primary, (dist.get(e.tuple.primary) || 0) + 1);
  console.log(`\n[baseline] total=${all.length}  stable=${stable}  errors=${errors}  → ${OUT}`);
  console.log("[baseline] primary_focus distribution:");
  for (const [p, n] of [...dist.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`   ${String(p).padEnd(14)} ${n}`);
  }
}

async function main(): Promise<void> {
  const corpus = loadCorpus(INPUT);
  const done = loadExisting();
  // Retry previously-errored entries; skip clean ones.
  const todo = corpus.filter((c) => !done.has(c.query) || done.get(c.query)?.error);
  console.log(
    `[baseline] corpus unique=${corpus.length}  already=${done.size}  todo=${todo.length}  RUNS=${RUNS}  out=${OUT}`,
  );
  if (todo.length === 0) {
    summarize(done);
    return;
  }

  let consecFail = 0;
  for (let i = 0; i < todo.length; i++) {
    const c = todo[i];
    try {
      const { tuple, tupleStr, stable } = await classifyMajority(c.query, RUNS);
      done.set(c.query, { ...c, tuple, tupleStr, stable });
      consecFail = 0;
    } catch (e) {
      consecFail++;
      const msg = e instanceof Error ? e.message : String(e);
      console.warn(`  ⚠️ [${i + 1}/${todo.length}] "${c.query.slice(0, 40)}" → ${msg}`);
      if (consecFail >= MAX_CONSECUTIVE_FAILS) {
        save(done);
        console.error(
          `\n[baseline] aborting after ${consecFail} consecutive failures — is the dev server + LM Studio up?` +
            `\n  Progress saved to ${OUT} (${done.size} done) — rerun to resume.`,
        );
        process.exit(2);
      }
      // Record as an error entry; it'll be retried on the next run.
      done.set(c.query, {
        ...c,
        tuple: { primary: "ERROR", topic: null, tickers: [], year: null, quarter: null },
        tupleStr: "ERROR",
        stable: false,
        error: msg,
      });
    }
    if ((i + 1) % FLUSH_EVERY === 0) {
      save(done);
      console.log(`  … ${i + 1}/${todo.length} (saved, ${Math.round((100 * (i + 1)) / todo.length)}%)`);
    }
  }

  save(done);
  summarize(done);
}

main().catch((e) => {
  console.error("[baseline] fatal:", e);
  process.exit(1);
});
