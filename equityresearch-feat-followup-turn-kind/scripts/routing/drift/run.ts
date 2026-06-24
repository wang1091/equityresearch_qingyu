#!/usr/bin/env tsx
/**
 * Phase 4 — routing drift detector.
 *
 * Re-classifies every STABLE baseline query through the live classifier and
 * diffs the routing tuple against the snapshot. Reports the drift rate + the
 * specific queries whose routing changed, and exits non-zero when drift on the
 * stable set exceeds DRIFT_THRESHOLD.
 *
 * IMPORTANT: run this with the SAME model/config the baseline was built with
 * (a baseline built on LM Studio only detects drift of that local model). Set
 * the same CLASSIFIER_LLM_* env as baseline.ts (classifies in-process):
 *
 *   CLASSIFIER_LLM_BASE_URL=http://127.0.0.1:1234/v1 CLASSIFIER_LLM_MODEL=qwen/qwen3.5-9b \
 *   npm run routing:drift:run
 *
 * Env: DRIFT_BASELINE, RUNS (default 1), DRIFT_THRESHOLD (default 0.02 = 2%).
 * Exit: 0 within threshold · 2 drift exceeded / classifier down · 1 fatal.
 */
import fs from "node:fs";
import { classifyMajority, type BaselineEntry } from "./shared";

const BASELINE = process.env.DRIFT_BASELINE || "scripts/baselines/routing-corpus.baseline.local.json";
const RUNS = Math.max(1, Number(process.env.RUNS) || 1);
const THRESHOLD = Number(process.env.DRIFT_THRESHOLD ?? 0.02);
const MAX_CONSECUTIVE_FAILS = 8;

async function main(): Promise<void> {
  if (!fs.existsSync(BASELINE)) {
    console.error(`[drift] baseline not found: ${BASELINE} — run \`npm run routing:drift:baseline\` first`);
    process.exit(1);
  }
  const baseline = JSON.parse(fs.readFileSync(BASELINE, "utf8")) as BaselineEntry[];
  const stable = baseline.filter((e) => e.stable && !e.error);
  console.log(
    `[drift] baseline=${baseline.length}  stable(comparable)=${stable.length}  RUNS=${RUNS}  threshold=${(THRESHOLD * 100).toFixed(1)}%`,
  );

  const changed: { query: string; from: string; to: string }[] = [];
  let consecFail = 0;
  let compared = 0;
  for (let i = 0; i < stable.length; i++) {
    const e = stable[i];
    let nowStr: string;
    try {
      nowStr = (await classifyMajority(e.query, RUNS)).tupleStr;
      consecFail = 0;
    } catch (err) {
      consecFail++;
      console.warn(`  ⚠️ "${e.query.slice(0, 40)}" → ${err instanceof Error ? err.message : String(err)}`);
      if (consecFail >= MAX_CONSECUTIVE_FAILS) {
        console.error(`[drift] aborting after ${consecFail} consecutive failures — server/LLM down?`);
        process.exit(2);
      }
      continue; // skip this query from the drift math
    }
    compared++;
    if (nowStr !== e.tupleStr) changed.push({ query: e.query, from: e.tupleStr, to: nowStr });
    if ((i + 1) % 50 === 0) console.log(`  … ${i + 1}/${stable.length}`);
  }

  const rate = compared ? changed.length / compared : 0;
  console.log(`\n[drift] compared=${compared}  changed=${changed.length}  drift=${(rate * 100).toFixed(2)}%`);
  for (const c of changed.slice(0, 50)) {
    console.log(`  ✗ ${c.query.slice(0, 50)}\n      ${c.from}\n   →  ${c.to}`);
  }
  if (changed.length > 50) console.log(`  … and ${changed.length - 50} more`);

  if (rate > THRESHOLD) {
    console.error(`\n[drift] FAIL — drift ${(rate * 100).toFixed(2)}% > threshold ${(THRESHOLD * 100).toFixed(1)}%`);
    process.exit(2);
  }
  console.log(`\n[drift] OK — within threshold`);
}

main().catch((e) => {
  console.error("[drift] fatal:", e);
  process.exit(1);
});
