/** GENERAL routing cases. Run: npx tsx scripts/routing/run.ts general
 *
 * Concept questions and sector-membership lists with no anchor ticker — answered
 * from training knowledge (need_api: false), no external API. The guard here is
 * that these do NOT get pulled into a ticker-required source. */
import type { Suite } from "./harness";

export const generalSuite: Suite = {
  name: "general",
  cases: [
    // ── guardrails: prompt-exemplified ──
    { query: "什么是市盈率?", tier: "guardrail", expect: { primary: "GENERAL", tickers: [] } },
    { query: "机器人板块有哪些公司？", tier: "guardrail", expect: { primary: "GENERAL", tickers: [] } },

    // ── targets: paraphrases ──
    { query: "explain how a DCF works", tier: "target", expect: { primary: "GENERAL", tickers: [] } },
    { query: "what is EBITDA?", tier: "target", expect: { primary: "GENERAL", tickers: [] } },
    { query: "半导体板块都有哪些龙头公司?", tier: "target", expect: { primary: "GENERAL", tickers: [] }, note: "sector list, no anchor" },
  ],
};
