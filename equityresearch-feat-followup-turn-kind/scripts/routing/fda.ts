/** FDA routing cases. Run: npx tsx scripts/routing/run.ts fda
 *
 * Drug approvals / PDUFA dates / clinical-trial milestones. FDA is ticker-
 * required, so these carry explicit uppercase tickers. The prompt gained worked
 * FDA examples in A4 (pure FDA → primary FDA; FDA+news → NEWS), replacing the
 * coercePureFdaQuery keyword force — these cases are the gate for that removal. */
import type { Suite } from "./harness";

export const fdaSuite: Suite = {
  name: "fda",
  cases: [
    // ── targets: the routing we want (ticker-anchored FDA questions) ──
    { query: "PFE FDA approval status", tier: "target", expect: { primary: "FDA", tickers: ["PFE"] } },
    { query: "any upcoming PDUFA dates for MRNA?", tier: "target", expect: { primary: "FDA", tickers: ["MRNA"] } },
    { query: "BNTX clinical trial results", tier: "target", expect: { primary: "FDA", tickers: ["BNTX"] } },
    { query: "did LLY get a new drug approval?", tier: "target", expect: { primary: "FDA", tickers: ["LLY"] } },
    { query: "MRNA 的药物审批进展", tier: "target", expect: { primary: "FDA", tickers: ["MRNA"] } },

    // ── anti-steal guardrail: a pure news ask about a biotech is NEWS, not FDA ──
    { query: "MRNA 最近有什么新闻?", tier: "guardrail", expect: { primary: "NEWS", tickers: ["MRNA"] }, note: "news lens, not FDA" },
    // A4 boundary: an explicit news ask that *mentions* approval stays NEWS-primary
    // (mirrors the old coercePureFdaQuery !isNews guard, now owned by the prompt).
    { query: "any news about Moderna's drug approval?", tier: "guardrail", expect: { primary: "NEWS", tickers: ["MRNA"] }, note: "explicit news ask → NEWS, not FDA" },
  ],
};
