// Standard regression harness for the competitive-analysis module.
//
// Runs the 8-ticker standard test suite (docs/competitive/COMPETITIVE_TEST_SUITE.md)
// directly against the pipeline — no HTTP server, no in-process cache, so repeated
// runs are clean and comparable. Each ticker has an encoded expectation (focus
// force band and/or differentiation/grounding checks) and is graded PASS/WARN/FAIL.
//
// Usage (from repo root):
//   npx tsx scripts/competitive-suite.mts                 # all 8, lang=en
//   npx tsx scripts/competitive-suite.mts --lang zh       # Chinese output
//   npx tsx scripts/competitive-suite.mts --tickers TSLA,AAPL
//   npx tsx scripts/competitive-suite.mts --label after   # name the result file
//   npx tsx scripts/competitive-suite.mts --baseline scripts/results/competitive-before.json
//
// Reads keys from .env.local. Exit code = number of FAILs (CI-usable).

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// ── env: load .env.local before the pipeline reads process.env ──
if (existsSync(`${REPO}/.env.local`)) {
  for (const line of readFileSync(`${REPO}/.env.local`, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    let v = m[2].trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    if (v && !process.env[m[1]]) process.env[m[1]] = v;
  }
}

const { runCompetitiveAnalysis } = await import(
  `${REPO}/server/competitive/service.ts`
);

// ── args ──
const argv = process.argv.slice(2);
const getArg = (name: string): string | undefined => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : undefined;
};
const lang = (getArg("lang") as "en" | "zh" | "both") || "en";
const label = getArg("label") || lang;
const tickerFilter = getArg("tickers")?.split(",").map((t) => t.trim().toUpperCase());
const baselinePath = getArg("baseline");

const FORCE_KEYS = [
  "competitive_rivalry",
  "threat_of_new_entrants",
  "threat_of_substitutes",
  "supplier_power",
  "buyer_power",
] as const;
type ForceKey = (typeof FORCE_KEYS)[number];

// Short codes for compact reporting (match the SCORES column header order).
const FORCE_CODE: Record<ForceKey, string> = {
  competitive_rivalry: "cr",
  threat_of_new_entrants: "ne",
  threat_of_substitutes: "sub",
  supplier_power: "sup",
  buyer_power: "buy",
};

// ── expectations (from COMPETITIVE_TEST_SUITE.md §一/§三) ──
// A focus force is graded: in `pass` band → PASS; in `warn` band → WARN;
// anything else → FAIL. Tickers without a focus force are graded only on
// differentiation (and optional industry keyword).
interface Spec {
  ticker: string;
  companyName: string;
  focus?: { force: ForceKey; pass: [number, number]; warn: [number, number] };
  industryIncludes?: string[]; // soft check (WARN if missing)
  note: string;
}

const SUITE: Spec[] = [
  { ticker: "TSLA", companyName: "Tesla", note: "balanced; differentiation + citations≥10" },
  { ticker: "AAPL", companyName: "Apple", focus: { force: "supplier_power", pass: [3, 4], warn: [5, 5] }, note: "supplier_power trap — low (3-4), not high" },
  { ticker: "HSAI", companyName: "Hesai Group", industryIncludes: ["lidar", "激光雷达"], note: "thin coverage; hallucination check (should be LiDAR)" },
  { ticker: "UAL", companyName: "United Airlines", focus: { force: "competitive_rivalry", pass: [9, 10], warn: [7, 8] }, note: "airline red ocean — HIGH rivalry" },
  { ticker: "LMT", companyName: "Lockheed Martin", focus: { force: "threat_of_new_entrants", pass: [1, 3], warn: [4, 5] }, note: "defense moat — LOW new entrants" },
  { ticker: "PARA", companyName: "Paramount Global", focus: { force: "threat_of_substitutes", pass: [8, 10], warn: [6, 7] }, note: "cord-cutting/streaming — HIGH substitutes" },
  { ticker: "AMD", companyName: "AMD", focus: { force: "supplier_power", pass: [8, 10], warn: [7, 7] }, note: "fabless TSMC dependence — HIGH supplier power" },
  { ticker: "CRUS", companyName: "Cirrus Logic", focus: { force: "buyer_power", pass: [9, 10], warn: [7, 8] }, note: "~89% Apple revenue — HIGH buyer power" },
];

const specs = SUITE.filter((s) => !tickerFilter || tickerFilter.includes(s.ticker));

type Grade = "PASS" | "WARN" | "FAIL";
const inBand = (v: number, [lo, hi]: [number, number]) => v >= lo && v <= hi;

interface Row {
  ticker: string;
  ok: boolean;
  error?: string;
  industry?: string;
  scores?: Record<ForceKey, number>;
  focusForce?: ForceKey;
  focusValue?: number;
  focusGrade?: Grade;
  diffGrade?: Grade; // differentiation
  industryGrade?: Grade;
  distinct?: number;
  range?: number;
  grounded?: boolean;
  sources?: number;
  analysisMs?: number;
  researchMs?: number;
  durationMs?: number;
  grade?: Grade; // worst of the sub-grades
}

const worst = (...g: (Grade | undefined)[]): Grade => {
  const order: Grade[] = ["PASS", "WARN", "FAIL"];
  return g.filter(Boolean).reduce<Grade>((acc, cur) =>
    order.indexOf(cur!) > order.indexOf(acc) ? cur! : acc, "PASS");
};

const rows: Row[] = [];

for (const spec of specs) {
  process.stderr.write(`\n>>> [${label}] ${spec.ticker} (${spec.note}) ...\n`);
  try {
    const res = await runCompetitiveAnalysis({
      ticker: spec.ticker,
      companyName: spec.companyName,
      lang,
    });
    const scores = Object.fromEntries(
      FORCE_KEYS.map((k) => [k, (res.forces as any)[k].score]),
    ) as Record<ForceKey, number>;
    const vals = Object.values(scores);
    const distinct = new Set(vals).size;

    // differentiation: all-equal → FAIL, ≤2 distinct → WARN
    const diffGrade: Grade = distinct === 1 ? "FAIL" : distinct <= 2 ? "WARN" : "PASS";

    let focusGrade: Grade | undefined;
    let focusValue: number | undefined;
    if (spec.focus) {
      focusValue = scores[spec.focus.force];
      focusGrade = inBand(focusValue, spec.focus.pass)
        ? "PASS"
        : inBand(focusValue, spec.focus.warn)
          ? "WARN"
          : "FAIL";
    }

    let industryGrade: Grade | undefined;
    if (spec.industryIncludes) {
      const hay = (res.industry || "").toLowerCase();
      industryGrade = spec.industryIncludes.some((kw) => hay.includes(kw.toLowerCase()))
        ? "PASS"
        : "WARN";
    }

    rows.push({
      ticker: spec.ticker,
      ok: true,
      industry: res.industry,
      scores,
      focusForce: spec.focus?.force,
      focusValue,
      focusGrade,
      diffGrade,
      industryGrade,
      distinct,
      range: Math.max(...vals) - Math.min(...vals),
      grounded: res.research_grounded,
      sources: res._sources?.length ?? 0,
      analysisMs: Math.round(res._meta.step_timings?.analysis_ms ?? 0),
      researchMs: Math.round(res._meta.step_timings?.research_ms ?? 0),
      durationMs: Math.round(res._meta.duration_ms),
      grade: worst(focusGrade, diffGrade, industryGrade),
    });
  } catch (e) {
    rows.push({
      ticker: spec.ticker,
      ok: false,
      grade: "FAIL",
      error: e instanceof Error ? `${(e as any).code ?? ""} ${e.message}`.trim() : String(e),
    });
  }
}

// ── persist ──
const resultsDir = `${REPO}/scripts/results`;
mkdirSync(resultsDir, { recursive: true });
const outPath = `${resultsDir}/competitive-${label}.json`;
writeFileSync(outPath, JSON.stringify({ label, lang, when: new Date().toISOString(), rows }, null, 2));

// ── optional baseline diff ──
let baseRows: Map<string, Row> | undefined;
if (baselinePath) {
  try {
    const base = JSON.parse(readFileSync(resolve(baselinePath), "utf8"));
    baseRows = new Map((base.rows as Row[]).map((r) => [r.ticker, r]));
  } catch (e) {
    process.stderr.write(`⚠️  could not read baseline ${baselinePath}: ${e}\n`);
  }
}

// ── report ──
const icon = (g?: Grade) => (g === "PASS" ? "✅" : g === "WARN" ? "🟡" : g === "FAIL" ? "❌" : "  ");
const out = process.stderr;
out.write(`\n${"=".repeat(78)}\n`);
out.write(`competitive suite [${label}]  lang=${lang}  ${new Date().toISOString()}\n`);
out.write(`${"=".repeat(78)}\n`);
out.write(`TICKER  SCORES(cr/ne/sub/sup/buy)  FOCUS              DIFF        GRND SRC  aMS\n`);
out.write(`${"-".repeat(78)}\n`);

for (const r of rows) {
  if (!r.ok) {
    out.write(`${r.ticker.padEnd(7)} ❌ FAIL  ${r.error}\n`);
    continue;
  }
  const s = FORCE_KEYS.map((k) => r.scores![k]).join("/");
  const focus = r.focusForce
    ? `${icon(r.focusGrade)}${FORCE_CODE[r.focusForce]}=${r.focusValue}`
    : "—";
  let line =
    `${r.ticker.padEnd(7)} ${s.padEnd(11)}${icon(r.grade)}  ` +
    `${focus.padEnd(17)} ${icon(r.diffGrade)}d=${r.distinct}/r=${r.range}  ` +
    `${r.grounded ? "y" : "n"}   ${String(r.sources).padEnd(3)} ${r.analysisMs}`;
  if (r.industryGrade) line += `  ${icon(r.industryGrade)}ind`;
  out.write(line + "\n");

  // baseline delta
  const b = baseRows?.get(r.ticker);
  if (b?.scores && r.scores) {
    const deltas = FORCE_KEYS.map((k) => {
      const d = r.scores![k] - b.scores![k];
      return d === 0 ? "·" : d > 0 ? `+${d}` : `${d}`;
    }).join("/");
    out.write(`        Δ vs baseline: ${deltas}\n`);
  }
}

const counts = { PASS: 0, WARN: 0, FAIL: 0 } as Record<Grade, number>;
for (const r of rows) counts[r.grade ?? "FAIL"]++;
out.write(`${"-".repeat(78)}\n`);
out.write(`PASS=${counts.PASS}  WARN=${counts.WARN}  FAIL=${counts.FAIL}   →  ${outPath}\n`);

process.exit(counts.FAIL);
