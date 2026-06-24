/**
 * Fire a battery of single-intent queries at a running agent so each card type
 * flows through formatDataAsCard, which (with DUMP_CARD_FIXTURES=1) writes the
 * exact apiData to server/agent/__fixtures__/cards/.
 *
 * Usage (two terminals):
 *   1. DUMP_CARD_FIXTURES=1 npm run dev
 *   2. BASE_URL=http://127.0.0.1:<port> npm run fixtures:cards
 *
 * The dev log prints the port, e.g. "listening on 0.0.0.0:5003".
 * Requires DEEPSEEK_API_KEY (live classifier) and reachable upstreams for the
 * sources you want real data for — unreachable upstreams capture the error/
 * unavailable branch instead, which is still a valid fixture.
 */
const BASE_URL = (process.env.BASE_URL || "http://127.0.0.1:5000").replace(/\/+$/, "");

// query → language. One representative single-intent query per card type/topic.
const BATTERY: Array<{ q: string; lang: "en" | "zh" }> = [
  { q: "What is NVDA's market cap?", lang: "en" }, // MARKET_DATA
  { q: "TSLA 的市值是多少?", lang: "zh" }, // MARKET_DATA (zh)
  { q: "特斯拉股价多少?", lang: "zh" }, // STOCK_PRICE (zh)
  { q: "what is AAPL trading at?", lang: "en" }, // STOCK_PRICE
  { q: "AAPL分析师评级", lang: "zh" }, // RATING (zh)
  { q: "analyst rating for TSLA", lang: "en" }, // RATING
  { q: "NVDA 2027 Q1 财报摘要卡片", lang: "zh" }, // EARNINGS summary
  { q: "give me NVDA's Q&A section", lang: "en" }, // EARNINGS qa
  { q: "今天有哪些公司发财报?", lang: "zh" }, // EARNINGS calendar
  { q: "NVDA valuation", lang: "en" }, // VALUATION
  { q: "show me apple's historical financial data", lang: "en" }, // PERFORMANCE
  { q: "What are today's top gainers?", lang: "en" }, // TRENDING
  { q: "PFE FDA approval status", lang: "en" }, // FDA
  { q: "rumor check: is Qualcomm going to acquire Intel?", lang: "en" }, // RUMOR
];

async function fire(q: string, lang: "en" | "zh"): Promise<void> {
  try {
    const res = await fetch(`${BASE_URL}/api/agent/chat-stream`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ conversationId: `fixcap-${Date.now()}`, message: q, language: lang }),
    });
    // Drain the stream so the server finishes (and the fixture is written).
    await res.text();
    console.log(`  ✓ [${lang}] ${q}`);
  } catch (e) {
    console.log(`  ✗ [${lang}] ${q} — ${e instanceof Error ? e.message : String(e)}`);
  }
}

async function main() {
  console.log(`🃏 Capturing card fixtures via ${BASE_URL} (server must run with DUMP_CARD_FIXTURES=1)\n`);
  for (const { q, lang } of BATTERY) {
    await fire(q, lang);
  }
  console.log(`\nDone. Fixtures written to server/agent/__fixtures__/cards/ (only for card types whose direct-card path was reached).`);
}

main();
