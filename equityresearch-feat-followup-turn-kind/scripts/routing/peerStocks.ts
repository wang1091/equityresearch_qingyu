/** PEER_STOCKS routing cases. Run: npx tsx scripts/routing/run.ts peerstocks
 *
 * Comparable-company list anchored to ONE ticker. Distinct from COMPETITIVE
 * (moat / Porter / positioning) and from GENERAL (sector list with no anchor).
 * Requires an anchor ticker, so a no-anchor "sector list" must NOT land here. */
import type { Suite } from "./harness";

export const peerStocksSuite: Suite = {
  name: "peerstocks",
  cases: [
    // ── guardrails: prompt-exemplified ──
    { query: "AAPL 的同行有哪些？", tier: "guardrail", expect: { primary: "PEER_STOCKS", tickers: ["AAPL"] } },

    // ── targets: paraphrases (anchor ticker present) ──
    { query: "peers of NVDA", tier: "target", expect: { primary: "PEER_STOCKS", tickers: ["NVDA"] } },
    { query: "list companies comparable to MSFT", tier: "target", expect: { primary: "PEER_STOCKS", tickers: ["MSFT"] } },
    { query: "who are TSLA's competitors?", tier: "target", expect: { primaryOneOf: ["PEER_STOCKS", "COMPETITIVE"], tickers: ["TSLA"] }, note: '"competitors" is ambiguous peer-list vs competitive' },

    // ── anti-steal guardrail: no anchor ticker → GENERAL, not PEER_STOCKS ──
    { query: "机器人板块有哪些公司？", tier: "guardrail", expect: { primary: "GENERAL", tickers: [] }, note: "sector list, no anchor → GENERAL" },
  ],
};
