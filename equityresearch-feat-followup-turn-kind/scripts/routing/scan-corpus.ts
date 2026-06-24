// One-off: classify the full production corpus (chat_queries.local.jsonl, 1282
// unique) with a chosen LLM and auto-flag suspicious routings. Cheap pre-filter
// (qwen3.5-9b local) → the flagged subset is then re-judged on DeepSeek.
//
//   SCAN_MODEL=qwen/qwen3.5-9b CONCURRENCY=5 \
//     npx tsx scripts/routing/scan-corpus.ts
//   (model knob is SCAN_MODEL — CLASSIFIER_LLM_MODEL is overwritten below.
//    Base URL stays CLASSIFIER_LLM_BASE_URL, default LM Studio :1234.)
//
// Resumable: appends to scripts/results/corpus-scan.jsonl and skips queries
// already present, so a re-run continues. Output is gitignored (scripts/results/).
import * as fs from "fs";
import * as path from "path";
import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });
loadEnv({ path: ".env" });
// Reuse the drift tooling's corpus loader (clean dedup + [Refine] strip +
// news-brief-button exclusion → the same 1280 unique the baseline uses).
import { loadCorpus } from "./drift/shared";

// Pure-local + free: pin the model, generous timeout, and NO Gemini failover
// (a local miss falls to the keyword fallback, which we want to SEE as a flag).
process.env.CLASSIFIER_LLM_MODEL = process.env.SCAN_MODEL || "qwen/qwen3.5-9b";
process.env.CLASSIFIER_LLM_BASE_URL = process.env.CLASSIFIER_LLM_BASE_URL || "http://localhost:1234/v1";
process.env.CLASSIFIER_LLM_TIMEOUT_MS = "120000";
delete process.env.GEMINI_API_KEY;
delete process.env.LLM_BASE_URL;
delete process.env.LLM_MODEL;

const CORPUS = "scripts/baselines/chat_queries.local.jsonl";
const OUT = "scripts/results/corpus-scan.jsonl";
const CONCURRENCY = Number(process.env.CONCURRENCY) || 5;

const TICKER_RE = /^[A-Z][A-Z.\-]{0,5}$/;

function flagsFor(r: any): string[] {
  const f: string[] = [];
  const req: string[] = r.required_data || [];
  const tk: string[] = r.tickers || [];
  if (r.need_api === false && tk.length > 0) f.push("no_api_with_ticker");
  if (typeof r.confidence === "number" && r.confidence < 0.5) f.push("low_conf");
  if (r.confidence === 0.6) f.push("keyword_fallback");
  if (tk.some((t) => !TICKER_RE.test(t))) f.push("bad_ticker");
  if (req.length === 0) f.push("empty_required");
  if (req.length > 0 && r.primary_focus && !req.includes(r.primary_focus)) f.push("primary_desync");
  if (typeof r.reasoning === "string" && /fallback|降级|keyword/i.test(r.reasoning)) f.push("fallback_reason");
  return f;
}

async function pool<T>(items: T[], n: number, fn: (x: T, i: number) => Promise<void>) {
  let idx = 0;
  const workers = Array.from({ length: n }, async () => {
    while (idx < items.length) {
      const i = idx++;
      await fn(items[i], i);
    }
  });
  await Promise.all(workers);
}

(async () => {
  const { classifyIntents } = await import("../../server/agent/classifier");
  const all = loadCorpus(CORPUS).map((c) => c.query);
  fs.mkdirSync(path.dirname(OUT), { recursive: true });

  const done = new Set<string>();
  if (fs.existsSync(OUT)) {
    for (const line of fs.readFileSync(OUT, "utf-8").split("\n")) {
      if (!line.trim()) continue;
      try { done.add(JSON.parse(line).query); } catch { /* skip */ }
    }
  }
  const todo = all.filter((q) => !done.has(q));
  console.log(`corpus=${all.length} done=${done.size} todo=${todo.length} model=${process.env.CLASSIFIER_LLM_MODEL} conc=${CONCURRENCY}`);

  const stream = fs.createWriteStream(OUT, { flags: "a" });
  let n = 0;
  const t0 = Date.now();
  await pool(todo, CONCURRENCY, async (q) => {
    let rec: any;
    try {
      const r = await classifyIntents(q, [], /[一-鿿]/.test(q) ? "zh" : "en");
      rec = {
        query: q,
        required_data: r.required_data,
        primary_focus: r.primary_focus,
        tickers: r.tickers,
        need_api: r.need_api,
        confidence: r.confidence,
        reasoning: r.reasoning,
        flags: flagsFor(r),
      };
    } catch (e) {
      rec = { query: q, error: e instanceof Error ? e.message : String(e), flags: ["error"] };
    }
    stream.write(JSON.stringify(rec) + "\n");
    n++;
    if (n % 25 === 0) {
      const rate = (Date.now() - t0) / n / 1000;
      console.log(`  ${n}/${todo.length}  (${rate.toFixed(1)}s/q, ~${((todo.length - n) * rate / 60).toFixed(0)}min left)`);
    }
  });
  stream.end();
  console.log(`done: scanned ${n} in ${((Date.now() - t0) / 60000).toFixed(1)}min → ${OUT}`);
})();
