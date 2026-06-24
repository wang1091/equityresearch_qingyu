/** Phase 1 tasks-shadow measurement (task-centric 地基块 #4). Run:
 *   BASE_URL=http://127.0.0.1:5003 RUNS=3 npx tsx scripts/routing/shadowTasks.ts
 *
 * NOT a pass/fail gate — a measurement of Phase 3 启动门槛 6: does the live classifier
 * STABLY emit a CORRECTLY-DECOMPOSED minimal task subset? For each §11 query it samples
 * the classifier RUNS times (default 3, for LLM jitter), reads the shadow `tasks`, runs
 * the Phase 2 compiler, and checks four things:
 *   1. emission     — ≥1 valid task on EVERY run (stability, not a single shot);
 *   2. rejects      — malformed candidates the server dropped (cls.tasksRejectedCount,
 *                     the raw count — the script cannot recover it from cleaned tasks);
 *   3. decomposition— task COUNT + compiled status + key entity roles vs shadowExpect
 *                     (source/ticker-set agreement alone can't catch a wrong merge);
 *   4. plan diff    — derived required_data AND tickers vs the live routing tuple.
 *
 * Record-only — execution is untouched. Verified on DeepSeek; 9B deferred.
 */
import { classifyLive, ClassifierUnavailable, type Case } from "./harness";
import { taskCentricSuite } from "./taskCentric";
import { compileTasks } from "../../server/agent/taskPlanning/compileTasks";
import { compareToRouting } from "../../server/agent/taskPlanning/shadow";
import type { RawTaskCandidate } from "../../server/agent/taskPlanning/types";

const RUNS = Math.max(1, Number(process.env.RUNS) || 3);

interface RunObs {
  validCount: number;
  rejected: number;
  status: string;
  taskCount: number;
  reqMatch: boolean;
  tickMatch: boolean;
  decompOk: boolean | null; // null = no shadowExpect
  decompWhy: string;
}

/** Normalize a "TICKER:role" pair: ticker upper-cased, role lower-cased, so the
 *  expected strings and the compiled entities compare apples-to-apples. */
const normRole = (s: string): string => {
  const [t, r] = s.split(":");
  return `${(t ?? "").toUpperCase()}:${(r ?? "").toLowerCase()}`;
};

const rolesOf = (tasks: { entities?: { ticker?: string; role?: string }[] }[]): Set<string> =>
  new Set(tasks.flatMap((t) => (t.entities ?? []).map((e) => normRole(`${e.ticker}:${e.role}`))));

/** Decomposition check against shadowExpect (taskCount + status + roles). */
function checkDecomp(
  plan: ReturnType<typeof compileTasks>,
  exp: Case["shadowExpect"],
): { ok: boolean | null; why: string } {
  if (!exp) return { ok: null, why: "" };
  const why: string[] = [];
  if (exp.taskCount !== undefined && plan.tasks.length !== exp.taskCount)
    why.push(`count ${plan.tasks.length}≠${exp.taskCount}`);
  if (exp.status !== undefined && plan.status !== exp.status) why.push(`status ${plan.status}≠${exp.status}`);
  if (exp.roles?.length) {
    const have = rolesOf(plan.tasks);
    const missing = exp.roles.filter((r) => !have.has(normRole(r)));
    if (missing.length) why.push(`roles missing [${missing}]`);
  }
  return { ok: why.length === 0, why: why.join("; ") };
}

const allSame = <T>(xs: T[]): boolean => xs.every((x) => x === xs[0]);

async function main() {
  console.log(`\n🔬 [shadow] emission stability + decomposition + plan diff — LIVE ×${RUNS}\n`);
  const cases = taskCentricSuite.cases;
  let emittedAll = 0; // ≥1 valid task on every run
  let rejectedTotal = 0; // malformed candidates (server count), summed over runs
  let reqAgreeAll = 0; // required_data set-equal on every run
  let decompOkAll = 0; // decomposition correct on every run (of cases with shadowExpect)
  let decompCases = 0;
  let flaky = 0; // any measured dimension varied across runs

  for (const c of cases) {
    const obs: RunObs[] = [];
    for (let i = 0; i < RUNS; i++) {
      let cls: Record<string, any>;
      try {
        cls = await classifyLive(c.query);
      } catch (e) {
        if (e instanceof ClassifierUnavailable) {
          console.error(`\n⏭️  SKIP — live classifier unavailable: ${e.message}`);
          process.exit(2);
        }
        throw e;
      }
      const valid: RawTaskCandidate[] = Array.isArray(cls.tasks) ? cls.tasks : [];
      const plan = compileTasks(valid);
      const cmp = compareToRouting(valid, { required_data: cls.required_data ?? [], tickers: cls.tickers ?? [] });
      const d = checkDecomp(plan, c.shadowExpect);
      obs.push({
        validCount: valid.length,
        rejected: typeof cls.tasksRejectedCount === "number" ? cls.tasksRejectedCount : 0,
        status: cmp.plannerStatus,
        taskCount: plan.tasks.length,
        reqMatch: cmp.requiredDataMatch,
        tickMatch: cmp.tickersMatch,
        decompOk: d.ok,
        decompWhy: d.why,
      });
    }

    rejectedTotal += obs.reduce((s, o) => s + o.rejected, 0);
    const emitted = obs.every((o) => o.validCount > 0);
    const reqAgree = obs.every((o) => o.reqMatch);
    const hasExp = c.shadowExpect !== undefined;
    const decompOk = hasExp && obs.every((o) => o.decompOk === true);
    const isFlaky =
      !allSame(obs.map((o) => o.taskCount)) ||
      !allSame(obs.map((o) => o.status)) ||
      !allSame(obs.map((o) => o.reqMatch)) ||
      !allSame(obs.map((o) => o.decompOk));

    if (emitted) emittedAll++;
    if (reqAgree) reqAgreeAll++;
    if (hasExp) {
      decompCases++;
      if (decompOk) decompOkAll++;
    }
    if (isFlaky) flaky++;

    const last = obs[obs.length - 1];
    const tags = [
      emitted ? "emit✓" : "emit✗",
      hasExp ? (decompOk ? "decomp✓" : "decomp✗") : "decomp—",
      reqAgree ? "req✓" : "req✗",
      last.tickMatch ? "tick✓" : "tick~", // ~ = differs (often intentional: evidence/mentioned excluded)
      isFlaky ? "FLAKY" : "",
    ].filter(Boolean).join(" ");
    console.log(`${tags}  ${c.query}`);
    console.log(
      `      tasks=${last.taskCount}${c.shadowExpect?.taskCount !== undefined ? `/exp${c.shadowExpect.taskCount}` : ""}` +
        ` · status=${last.status} · rejected/run=${obs.map((o) => o.rejected).join(",")}` +
        (hasExp && !decompOk ? ` · decomp: ${obs.find((o) => o.decompOk === false)?.decompWhy ?? "?"}` : ""),
    );
  }

  const n = cases.length;
  const pct = (x: number, of: number) => `${x}/${of} (${of ? Math.round((100 * x) / of) : 0}%)`;
  console.log(`\n══════════ SHADOW SUMMARY (×${RUNS}) ══════════`);
  console.log(`emission (≥1 valid task on EVERY run): ${pct(emittedAll, n)}`);
  console.log(`decomposition correct (count+status+roles, every run): ${pct(decompOkAll, decompCases)}`);
  console.log(`required_data agreement (every run): ${pct(reqAgreeAll, n)}`);
  console.log(`flaky across runs: ${flaky}/${n}`);
  console.log(`malformed candidates dropped by server (summed): ${rejectedTotal}`);
  console.log(`\nRecord-only —门槛 6 evidence, not a gate. tick~ / req✗ divergences are often correct`);
  console.log(`(task layer returns clarification, or subjectTickers excludes evidence/mentioned).\n`);
}

main();
