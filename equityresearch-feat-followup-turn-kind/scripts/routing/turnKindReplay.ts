// turn_kind replay verifier — the history-capable runner for the orthogonal
// turn_kind / operationType axis (docs/FOLLOWUP_TURN_GATE_DESIGN.md §十二.1).
//
// The standard routing harness hardcodes empty history (harness.ts:191) and tests
// SOURCE routing on a fresh turn, so it can neither test a rule that fires WITH a
// prior projection turn (SET_RULE) nor the TRANSFORM operationType (orthogonal axis,
// and "Translate … into Chinese" routes red today → would break the guardrail
// "all green" gate). This runner mirrors the live front-half decision —
// detectTranslateCommand() short-circuits BEFORE classifyTurn, else classifyIntents —
// and asserts the resulting {operationType, need_api, tickers, required_data,
// payloadSource}. Sections: SET_RULE (existing) / TRANSFORM (Phase 2) / future
// CORRECT/RECALL/DRILL_IN. inline vs contextual = `history: []` vs `history: [...]`.
//
//   DEEPSEEK=1 LOG_LEVEL=error RUNS=5 npx tsx --env-file=.env.local scripts/routing/turnKindReplay.ts
//   CLASSIFIER_LLM_MODEL=qwen/qwen3.5-9b RUNS=5 npx tsx scripts/routing/turnKindReplay.ts
import { classifyIntents } from "../../server/agent/classifier";
import type { ConversationTurn } from "../../server/agent/classifier/types";
import { detectTranslateCommand, detectCorrection, detectChitchat, detectRecall } from "../../server/agent/turnKind";
import { patchCorrectedPlan } from "../../server/agent/resolvePlan";
import type { LastTurnFrame } from "../../server/agent/conversation";

const RUNS = Number(process.env.RUNS || 5);

// The assistant projection line is exactly what projectListTurnToHistory emits.
const trendingHistory: ConversationTurn[] = [
  { role: "user", content: "今日涨幅最大的股票" },
  {
    role: "assistant",
    content:
      "[TRENDING top_gainers @2026-06-21] BFLY/Butterfly Net +55.87%; WOLF/Wolfspeed +17.91%; QS/QuantumScape +16.52%; BE/Bloom Energy +15.41%; OUST/Ouster +14.37%",
  },
];
const SET = ["BFLY", "WOLF", "QS", "BE", "OUST"];

// A realistic prior prose answer — the payload a contextual "翻译上面的" reads.
const proseHistory: ConversationTurn[] = [
  { role: "user", content: "Why did Nvidia jump?" },
  { role: "assistant", content: "Nvidia rose on strong data-center demand and a raised outlook." },
];

/** What the live front-half resolves the turn to (operationType + routing tuple). */
type TurnResolution = {
  operationType: "ANSWER" | "TRANSFORM" | "CORRECT" | "CHITCHAT" | "RECALL";
  tickers: string[];
  required_data: string[];
  need_api: boolean;
  payloadSource?: "inline_text" | "previous_assistant_message";
};

type Case = {
  name: string;
  query: string;
  history: ConversationTurn[];
  /** Synthetic prior-turn frame (CORRECT cases) — mirrors what prepareTurn records. */
  lastTurn?: LastTurnFrame;
  /** Soft-red: a documented known gap. Reported but NOT counted against "all green". */
  target?: boolean;
  check: (r: TurnResolution) => string | null; // null = pass
};

type Section = { name: string; cases: Case[] };

const upper = (xs: string[]) => xs.map((x) => x.toUpperCase());
const hasAll = (got: string[], want: string[]) => want.every((w) => upper(got).includes(w));
const hasAny = (got: string[], want: string[]) => want.some((w) => upper(got).includes(w));

/**
 * Mirror the live front-half (prepareTurn): CORRECT detected first (needs a frame, defers
 * its patch to post-classify); else TRANSFORM / CHITCHAT pre-classify short-circuits; else
 * classify → (CORRECT patch | FRESH ANSWER).
 */
async function resolveTurn(
  query: string,
  history: ConversationTurn[],
  lastTurn?: LastTurnFrame,
): Promise<TurnResolution> {
  const isCorrection = !!lastTurn && detectCorrection(query);
  if (!isCorrection) {
    const op = detectTranslateCommand(query, history);
    if (op) {
      return { operationType: "TRANSFORM", tickers: [], required_data: [], need_api: false, payloadSource: op.payloadSource };
    }
    if (detectChitchat(query)) {
      return { operationType: "CHITCHAT", tickers: [], required_data: [], need_api: false };
    }
    // RECALL — gated on the prior turn carrying a data snapshot (Phase 4a).
    if (lastTurn?.snapshot && detectRecall(query)) {
      return { operationType: "RECALL", tickers: [], required_data: [], need_api: false };
    }
  }
  const r = await classifyIntents(query, history, "zh");
  if (isCorrection) {
    const patched = patchCorrectedPlan(
      { tickers: r.tickers, required_data: r.required_data, primary_focus: r.primary_focus, api_params: r.api_params, need_api: r.need_api },
      lastTurn!,
    );
    if (patched) {
      return {
        operationType: "CORRECT",
        tickers: patched.classification.tickers || [],
        required_data: patched.classification.required_data || [],
        need_api: patched.plan.needApi,
      };
    }
  }
  return {
    operationType: "ANSWER",
    tickers: r.tickers || [],
    required_data: r.required_data || [],
    need_api: r.need_api !== false,
  };
}

const SET_RULE: Section = {
  name: "SET_RULE — screen over the prior result set (HISTORY_PROJECTION_PLAN step b)",
  cases: [
    {
      name: "POS set-anaphor → materialize full set (业绩)",
      query: "这些里哪只业绩最强?",
      history: trendingHistory,
      check: (r) => (hasAll(r.tickers, SET) ? null : `expected all of ${SET} in tickers, got [${r.tickers}]`),
    },
    {
      name: "POS set-anaphor (其中 / 市值)",
      query: "其中市值最大的是哪只?",
      history: trendingHistory,
      check: (r) => (hasAll(r.tickers, SET) ? null : `expected all of ${SET} in tickers, got [${r.tickers}]`),
    },
    {
      name: "NEG pivot to new entity → NOT the set",
      query: "苹果呢?",
      history: trendingHistory,
      check: (r) => (hasAny(r.tickers, SET) ? `should NOT carry the set; got [${r.tickers}]` : null),
    },
    {
      name: "NEG singular ref → single ticker (defer to pronoun rule)",
      query: "第一个详细说说",
      history: trendingHistory,
      check: (r) => (r.tickers.length > 1 ? `singular ref should not fan to set; got [${r.tickers}]` : null),
    },
    {
      name: "POS set-anaphor (这几只 / 估值) → set + VALUATION lens",
      query: "这几只里哪只估值最贵?",
      history: trendingHistory,
      check: (r) =>
        !hasAll(r.tickers, SET)
          ? `expected set, got [${r.tickers}]`
          : r.required_data.includes("VALUATION")
            ? null
            : `expected VALUATION lens, got [${r.required_data}]`,
    },
    {
      name: "POS English (which of these / market cap) → set + MARKET_DATA",
      query: "which of these has the largest market cap?",
      history: trendingHistory,
      check: (r) => (hasAll(r.tickers, SET) ? null : `expected set, got [${r.tickers}]`),
    },
    {
      name: "NEG fresh comparison (no history) → only the two named, no carry",
      query: "对比 AMD 和 NVDA 的财务表现",
      history: [],
      check: (r) => (hasAny(r.tickers, SET) ? `should not carry prior set; got [${r.tickers}]` : null),
    },
    {
      name: "NEG unrelated fresh query after a list → must NOT inherit the set",
      query: "什么是市盈率?",
      history: trendingHistory,
      check: (r) => (hasAny(r.tickers, SET) ? `concept question should not carry the set; got [${r.tickers}]` : null),
    },
  ],
};

const TRANSFORM: Section = {
  name: "TRANSFORM — translate command short-circuit (FOLLOWUP_TURN_GATE_DESIGN §十二)",
  cases: [
    {
      // The negative guard this Phase buys NOW: outputLanguage ("用中文…") must NOT
      // be mistaken for a translate command — it keeps its finance intent + need_api.
      name: "NEG 用中文解释 Nvidia 为什么上涨 → ANSWER + finance (need_api, NVDA)",
      query: "用中文解释 Nvidia 为什么上涨",
      history: [],
      check: (r) =>
        r.operationType !== "ANSWER"
          ? `outputLanguage must stay ANSWER, got ${r.operationType}`
          : !r.need_api
            ? `finance answer should need api`
            : !hasAny(r.tickers, ["NVDA"])
              ? `expected NVDA, got [${r.tickers}]`
              : null,
    },
    {
      name: "POS inline translate command → TRANSFORM (inline_text, no api)",
      query: "翻译成中文：The Fed held rates steady amid cooling inflation.",
      history: [],
      check: (r) =>
        r.operationType !== "TRANSFORM"
          ? `expected TRANSFORM, got ${r.operationType}`
          : r.need_api
            ? `TRANSFORM must not call api`
            : r.payloadSource !== "inline_text"
              ? `expected inline_text, got ${r.payloadSource}`
              : null,
    },
    {
      name: "POS contextual bare command + prior turn → TRANSFORM (previous_assistant_message)",
      query: "翻译成中文",
      history: proseHistory,
      check: (r) =>
        r.operationType !== "TRANSFORM"
          ? `expected TRANSFORM, got ${r.operationType}`
          : r.payloadSource !== "previous_assistant_message"
            ? `expected previous_assistant_message, got ${r.payloadSource}`
            : null,
    },
    {
      name: "POS contextual anaphor (translate that into English) → TRANSFORM",
      query: "translate that into English",
      history: [{ role: "assistant", content: "英伟达因数据中心需求强劲而上涨。" }],
      check: (r) =>
        r.operationType !== "TRANSFORM"
          ? `expected TRANSFORM, got ${r.operationType}`
          : r.payloadSource !== "previous_assistant_message"
            ? `expected previous_assistant_message, got ${r.payloadSource}`
            : null,
    },
    {
      name: "NEG bare translate command, EMPTY history → no payload → defer to classifier",
      query: "翻译成中文",
      history: [],
      check: (r) =>
        r.operationType !== "ANSWER" ? `no resolvable payload → should defer to ANSWER, got ${r.operationType}` : null,
    },
    {
      // The QUOTED variant resolves deterministically: quotes mark the literal
      // payload (an explicit inline_text), so the same words go green.
      name: 'POS quoted literal: Translate "Tesla earnings call" into Chinese → TRANSFORM (inline_text)',
      query: 'Translate "Tesla earnings call" into Chinese.',
      history: [],
      check: (r) =>
        r.operationType !== "TRANSFORM"
          ? `expected TRANSFORM, got ${r.operationType}`
          : r.payloadSource !== "inline_text"
            ? `expected inline_text, got ${r.payloadSource}`
            : null,
    },
    {
      // SOFT-RED (target): UNQUOTED, command names a fetchable object → no
      // deterministic payload (literal-phrase vs fetch-then-translate is ambiguous
      // without a delimiter). Routes red today (EARNINGS+TSLA+need_api). The fix is
      // a classifier-side outputLanguage signal, not this rule. Records the gap; not gated.
      name: "TARGET unquoted translate <fetchable object> into Chinese → ideally TRANSFORM (known gap)",
      query: "Translate Tesla earnings call into Chinese.",
      history: [],
      target: true,
      check: (r) => (r.operationType === "TRANSFORM" ? null : `still routes to ${r.operationType} (need_api=${r.need_api}, tickers=[${r.tickers}])`),
    },
  ],
};

// Prior turn: VALUATION on 百度/BIDU (explainer lens) — what prepareTurn records.
const bidúValuationFrame: LastTurnFrame = {
  classification: { required_data: ["VALUATION"], primary_focus: "VALUATION", tickers: ["BIDU"], api_params: { VALUATION: { ticker: "BIDU", query: "百度估值" } }, need_api: true },
  answerIntent: "explainer",
  resultTickers: ["BIDU"],
  source: "VALUATION",
};
const bidúHistory: ConversationTurn[] = [
  { role: "user", content: "百度估值如何" },
  { role: "assistant", content: "[VALUATION BIDU] 百度的内在价值约…" },
];

const CORRECT: Section = {
  name: "CORRECT — correction patches prior intent (FOLLOWUP_TURN_GATE_DESIGN §4.3)",
  cases: [
    {
      // SOFT-RED: entity resolution depends on the classifier returning the corrected
      // ticker (阿里→BABA). 9B may safe-abstain; recorded, not gated. Asserts the lens
      // (VALUATION) is INHERITED from the prior turn, not re-routed from the correction.
      name: "TARGET 我说的是阿里不是百度 → CORRECT, inherit VALUATION lens + BABA",
      query: "我说的是阿里不是百度",
      history: bidúHistory,
      lastTurn: bidúValuationFrame,
      target: true,
      check: (r) =>
        r.operationType !== "CORRECT"
          ? `expected CORRECT, got ${r.operationType}`
          : !r.required_data.includes("VALUATION")
            ? `expected inherited VALUATION lens, got [${r.required_data}]`
            : !hasAny(r.tickers, ["BABA"])
              ? `expected corrected BABA, got [${r.tickers}]`
              : null,
    },
    {
      name: "NEG pivot to new entity (苹果呢?) with a frame → ANSWER, not CORRECT",
      query: "苹果呢?",
      history: bidúHistory,
      lastTurn: bidúValuationFrame,
      check: (r) => (r.operationType === "CORRECT" ? `should not be CORRECT; got CORRECT [${r.tickers}]` : null),
    },
    {
      name: "NEG correction structure but NO prior frame → ANSWER (FRESH)",
      query: "我说的是阿里不是百度",
      history: [],
      check: (r) => (r.operationType === "CORRECT" ? `no frame → must not be CORRECT` : null),
    },
  ],
};

const CHITCHAT: Section = {
  name: "CHITCHAT — pleasantry / capability short-circuit (FOLLOWUP_TURN_GATE_DESIGN §4.2)",
  cases: [
    {
      name: "POS 谢谢 → CHITCHAT, no fetch",
      query: "谢谢",
      history: [],
      check: (r) => (r.operationType !== "CHITCHAT" ? `expected CHITCHAT, got ${r.operationType}` : r.need_api ? `must not fetch` : null),
    },
    {
      name: "POS 你能做什么 → CHITCHAT",
      query: "你能做什么",
      history: [],
      check: (r) => (r.operationType !== "CHITCHAT" ? `expected CHITCHAT, got ${r.operationType}` : null),
    },
    {
      name: "NEG 苹果财报怎么样 → ANSWER + need_api (chitchat must not over-fire)",
      query: "苹果财报怎么样",
      history: [],
      check: (r) =>
        r.operationType !== "ANSWER" ? `expected ANSWER, got ${r.operationType}` : !r.need_api ? `finance query should need api` : null,
    },
  ],
};

// Prior turn carrying a data snapshot (what commitAssistantTurn records on a data
// turn). The RECALL gate only fires when this is present; `sources` content is
// irrelevant to routing (the gate checks `lastTurn?.snapshot` truthiness).
const valuationSnapshotFrame: LastTurnFrame = {
  classification: { required_data: ["VALUATION"], primary_focus: "VALUATION", tickers: ["NVDA"], api_params: { VALUATION: { ticker: "NVDA" } }, need_api: true },
  answerIntent: "explainer",
  resultTickers: ["NVDA"],
  source: "VALUATION",
  snapshot: { capturedAt: "2026-06-22T08:00:00.000Z", validData: { VALUATION: { ticker: "NVDA" } }, sources: [] },
};
// Same frame WITHOUT a snapshot (need_api=false turn / reload) — RECALL must defer.
const noSnapshotFrame: LastTurnFrame = { ...valuationSnapshotFrame, snapshot: undefined };
const valuationHistory: ConversationTurn[] = [
  { role: "user", content: "英伟达估值如何" },
  { role: "assistant", content: "[VALUATION NVDA] 英伟达的内在价值约…" },
];

const RECALL: Section = {
  name: "RECALL — origin/freshness over the prior data snapshot (TURN_KIND_PHASE_4A_PLAN §3)",
  cases: [
    {
      name: "POS 数据哪来的 + snapshot → RECALL, no fetch",
      query: "数据哪来的",
      history: valuationHistory,
      lastTurn: valuationSnapshotFrame,
      check: (r) => (r.operationType !== "RECALL" ? `expected RECALL, got ${r.operationType}` : r.need_api ? `RECALL must not fetch` : null),
    },
    {
      name: "POS Where does this data come from? + snapshot → RECALL",
      query: "Where does this data come from?",
      history: valuationHistory,
      lastTurn: valuationSnapshotFrame,
      check: (r) => (r.operationType !== "RECALL" ? `expected RECALL, got ${r.operationType}` : null),
    },
    {
      name: "NEG 数据哪来的 but NO snapshot → defer to ANSWER",
      query: "数据哪来的",
      history: valuationHistory,
      lastTurn: noSnapshotFrame,
      check: (r) => (r.operationType === "RECALL" ? `no snapshot → must not RECALL` : null),
    },
    {
      name: "NEG ambiguous 收入来源是什么 (finance) + snapshot → ANSWER, not RECALL",
      query: "收入来源是什么",
      history: valuationHistory,
      lastTurn: valuationSnapshotFrame,
      check: (r) => (r.operationType === "RECALL" ? `finance 来源 must not RECALL; got RECALL` : null),
    },
    {
      name: "NEG bare 来源是什么 (no data anchor) + snapshot → ANSWER",
      query: "来源是什么",
      history: valuationHistory,
      lastTurn: valuationSnapshotFrame,
      check: (r) => (r.operationType === "RECALL" ? `bare 来源 must not RECALL; got RECALL` : null),
    },
  ],
};

const sections: Section[] = [SET_RULE, TRANSFORM, CORRECT, CHITCHAT, RECALL];

async function main() {
  let hardFails = 0;
  for (const section of sections) {
    console.log(`\n=== ${section.name} ===`);
    for (const c of section.cases) {
      let pass = 0;
      const fails: string[] = [];
      for (let i = 0; i < RUNS; i++) {
        try {
          const r = await resolveTurn(c.query, c.history, c.lastTurn);
          const err = c.check(r);
          if (err) fails.push(`run${i}: ${err}`);
          else pass++;
        } catch (e) {
          fails.push(`run${i}: THREW ${e instanceof Error ? e.message : String(e)}`);
        }
      }
      const tag = c.target ? (pass === RUNS ? "🎯✅" : "🎯") : pass === RUNS ? "✅" : pass === 0 ? "❌" : "⚠️";
      console.log(`${tag} ${pass}/${RUNS}  ${c.name}`);
      if (fails.length) console.log("   " + fails.slice(0, 3).join("\n   "));
      if (!c.target && pass !== RUNS) hardFails++;
    }
  }
  console.log(`\n${hardFails === 0 ? "✅ all non-target cases green" : `❌ ${hardFails} hard failure(s)`}`);
}

main().then(() => process.exit(0));
