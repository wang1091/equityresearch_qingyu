/**
 * Unified routing-regression runner.
 *
 *   npx tsx scripts/routing/run.mts             # all modules
 *   npx tsx scripts/routing/run.mts stockpicker # one module
 *   npx tsx scripts/routing/run.mts earnings competitive
 *
 * Needs the dev server + DeepSeek key (live classifier). Env: BASE_URL, RUNS.
 * Exit: 0 = all guardrails green · 1 = a guardrail failed · 2 = classifier
 * unavailable (skipped).
 */
import { runSuite, ClassifierUnavailable, type Suite, type SuiteResult } from "./harness";
import { stockPickerSuite } from "./stockPicker";
import { earningsSuite } from "./earnings";
import { competitiveSuite } from "./competitive";
import { stockPriceSuite } from "./stockPrice";
import { valuationSuite } from "./valuation";
import { newsSuite } from "./news";
import { performanceSuite } from "./performance";
import { ratingSuite } from "./rating";
import { peerStocksSuite } from "./peerStocks";
import { fdaSuite } from "./fda";
import { rumorSuite } from "./rumor";
import { trendingSuite } from "./trending";
import { marketDataSuite } from "./marketData";
import { generalSuite } from "./general";
import { multiIntentSuite } from "./multiIntent";
import { taskCentricSuite } from "./taskCentric";

// One suite per classifier data source — every API the router can pick has
// routing coverage here. Keys are the CLI selectors (npx tsx run.ts <key>).
const ALL: Record<string, Suite> = {
  stockpicker: stockPickerSuite,
  earnings: earningsSuite,
  competitive: competitiveSuite,
  stockprice: stockPriceSuite,
  valuation: valuationSuite,
  news: newsSuite,
  performance: performanceSuite,
  rating: ratingSuite,
  peerstocks: peerStocksSuite,
  fda: fdaSuite,
  rumor: rumorSuite,
  trending: trendingSuite,
  marketdata: marketDataSuite,
  general: generalSuite,
  multiintent: multiIntentSuite,
  taskcentric: taskCentricSuite,
};

async function main() {
  const args = process.argv.slice(2).map((a) => a.toLowerCase());
  const picked = args.filter((a) => ALL[a]);
  const unknown = args.filter((a) => !ALL[a]);
  if (unknown.length) {
    console.error(`Unknown module(s): ${unknown.join(", ")}. Known: ${Object.keys(ALL).join(", ")}`);
    process.exit(1);
  }
  const suites = picked.length ? picked.map((a) => ALL[a]) : Object.values(ALL);

  const results: SuiteResult[] = [];
  try {
    for (const suite of suites) {
      results.push(await runSuite(suite));
    }
  } catch (e) {
    if (e instanceof ClassifierUnavailable) {
      console.error(`\n⏭️  SKIP — live classifier unavailable: ${e.message}`);
      process.exit(2);
    }
    throw e;
  }

  // ── aggregate ──
  console.log(`\n══════════ ROUTING SUMMARY ══════════`);
  let totalFail = 0;
  let totalRed = 0;
  for (const r of results) {
    totalFail += r.guardrailFailures;
    totalRed += r.targetRed;
    const status = r.guardrailFailures === 0 ? "✅" : "❌";
    console.log(
      `${status} ${r.name.padEnd(12)} pass ${r.pass}/${r.total} · guardrail-fail ${r.guardrailFailures} · target-red ${r.targetRed}`,
    );
  }
  console.log(
    `\n${totalFail === 0 ? "ALL GUARDRAILS GREEN ✅" : `${totalFail} GUARDRAIL(S) FAILED ❌`}` +
      `${totalRed ? ` · ${totalRed} target(s) still red` : ""}\n`,
  );
  process.exit(totalFail === 0 ? 0 : 1);
}

main();
