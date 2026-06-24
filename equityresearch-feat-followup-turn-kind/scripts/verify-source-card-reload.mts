/**
 * Reload-parity harness for the generic `source_card` channel.
 *
 * For every migrated source it: serializes a representative turn exactly as the
 * client does (envelopeForMessage → source_card), POSTs it to the live server's
 * /data/chat-history (auth = the `x-auth-user` header a prod gateway injects),
 * GETs it back, and asserts the persisted bytes + the restored cardData survive
 * the round-trip through Postgres — i.e. reload === live. It also prints the
 * classifier-history projection each turn persists (the line follow-up routing
 * resolves from), so you can eyeball that it stays sane.
 *
 * Prereqs:
 *   - dev server running on :5003 (npm run dev)
 *   - a reachable Postgres (DATABASE_URL); tables created (npm run db:push)
 * Run:  npx tsx scripts/verify-source-card-reload.mts
 *
 * This is a dev/QA tool — it cleans up the conversations it creates.
 */
import {
  serializeEnvelope,
  parseEnvelope,
  specFor,
  projectToClassifierHistory,
  type TurnEnvelope,
} from "../shared/turnHistory";

const BASE = process.env.BASE_URL ?? "http://127.0.0.1:5003";
const DATA = `${BASE}/data`;
const headers = {
  "Content-Type": "application/json",
  "x-auth-user": "reload-harness-user",
  "x-auth-email": "harness@local",
};

/** One representative payload per source + a predicate that the restored payload survived. */
type Case = { source: string; payload: any; check: (p: any) => boolean };

const CASES: Case[] = [
  {
    source: "STOCK_PRICE",
    payload: { success: true, ticker: "AAPL", currency: "USD", currentPrice: { price: 298.01, change: 2.06, changePercent: 0.7 }, chartData: [] },
    check: (p) => p?.ticker === "AAPL" && p?.currentPrice?.price === 298.01,
  },
  {
    source: "VALUATION",
    payload: { success: true, ticker: "NVDA", current_price: 207.41, valuations: { dcf: { target_price: 60.7 }, relative: {} }, ai_recommendation: { decision: "OVERVALUED", chosen_price: 60.7, upside_percentage: "-70.7" }, analyst: null },
    check: (p) => p?.ai_recommendation?.decision === "OVERVALUED",
  },
  {
    source: "PERFORMANCE",
    payload: { primaryTicker: "AAPL", peers: ["MSFT"], metrics: { AAPL: {} }, analysis: { ticker: "AAPL", analysis: JSON.stringify({ rating: "Inline" }) } },
    check: (p) => p?.primaryTicker === "AAPL",
  },
  {
    source: "RATING",
    payload: { ticker: "AAPL", rating: "BUY", price: 298.01, valuation: { status: "Fairly Valued" } },
    check: (p) => p?.rating === "BUY",
  },
  {
    source: "FDA",
    payload: { success: true, data: { company: "Pfizer", ticker: "PFE", drugs: [{ drug: "Examplemab", status: "PENDING" }] } },
    check: (p) => p?.data?.ticker === "PFE",
  },
  {
    source: "TRENDING",
    payload: { success: true, date: "2026-06-20", categories: [{ id: "top_gainers", stocks: [{ ticker: "NVDA", companyName: "Nvidia", changePercent: 5.2 }] }] },
    check: (p) => p?.categories?.[0]?.stocks?.[0]?.ticker === "NVDA",
  },
  {
    source: "MARKET_DATA",
    payload: { success: true, queryType: "market_cap", fetchedAt: "2026-06-20T12:00:00.000Z", quotes: [{ ticker: "NVDA", companyName: "NVIDIA Corp", sector: "Technology" }] },
    check: (p) => p?.quotes?.[0]?.ticker === "NVDA",
  },
  {
    source: "RUMOR",
    payload: { rumor: "Qualcomm is going to acquire Intel", label: "Unverified", confidence: "Low", summary: "no confirmation", sources: [] },
    check: (p) => p?.label === "Unverified",
  },
  {
    source: "EARNINGS",
    payload: { topic: "ask", ticker: "AAPL", year: 2025, quarter: 2, hasAnswer: true, answer: "Revenue grew 5% YoY" },
    check: (p) => p?.ticker === "AAPL",
  },
  {
    source: "COMPETITIVE",
    payload: { success: true, company: "Joby Aviation", ticker: "JOBY", industry: "eVTOL", overall_assessment: "Early-mover moat.", forces: {} },
    check: (p) => p?.ticker === "JOBY",
  },
  {
    source: "STOCK_PICKER",
    payload: { mode: "comparison", labels: ["AAPL", "MSFT"], results: [{ ticker: "AAPL", recommendation: "BUY", finalScore: 82 }] },
    check: (p) => p?.results?.[0]?.ticker === "AAPL",
  },
];

// Legacy backward-compat: a conversation persisted BEFORE COMPETITIVE was folded
// carries `type:"competitive"` with `competitiveData` — it must still reload into cardData.
const LEGACY_COMPETITIVE: TurnEnvelope = {
  version: 1,
  type: "competitive",
  content: "",
  competitiveData: { success: true, company: "Joby Aviation", ticker: "JOBY", industry: "eVTOL", overall_assessment: "Early-mover moat.", forces: {} },
};

async function roundTrip(env: TurnEnvelope, label: string): Promise<{ ok: boolean; projection: string; restored: any; serialized: string }> {
  const conversationId = `reload-harness-${label}-${Date.now()}`;
  const serialized = serializeEnvelope(env);
  const projection = projectToClassifierHistory(serialized);

  const post = await fetch(`${DATA}/chat-history`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      conversationId,
      messages: [
        { role: "user", content: `q ${label}`, timestamp: new Date().toISOString() },
        { role: "assistant", content: serialized, timestamp: new Date().toISOString() },
      ],
    }),
  });
  if (!post.ok) throw new Error(`POST failed (${post.status}) — is the server up and DB reachable? ${await post.text()}`);

  const get = await fetch(`${DATA}/chat-history/${conversationId}`, { headers });
  const body = await get.json();
  const assistant = body.messages?.find((m: any) => m.role === "assistant");
  const env2 = parseEnvelope(assistant?.content ?? "");
  const restored: any = specFor(env2.type).restore?.(env2);

  await fetch(`${DATA}/chat-history/${conversationId}`, { method: "DELETE", headers });
  return { ok: assistant?.content === serialized, projection, restored, serialized };
}

async function main() {
  let allOk = true;

  for (const c of CASES) {
    const env: TurnEnvelope = { version: 1, type: "source_card", content: "", cardData: { source: c.source, payload: c.payload } };
    try {
      const { ok, projection, restored } = await roundTrip(env, c.source);
      const cardOk = restored?.cardData?.source === c.source && c.check(restored?.cardData?.payload);
      const pass = ok && cardOk;
      allOk = allOk && pass;
      console.log(`${pass ? "✅" : "❌"} ${c.source.padEnd(13)} reload=${ok} cardData=${cardOk}  ·  ${projection.slice(0, 90)}`);
    } catch (e) {
      allOk = false;
      console.log(`❌ ${c.source.padEnd(13)} ${(e as Error).message}`);
    }
  }

  // backward-compat legacy competitive envelope
  try {
    const { restored, projection } = await roundTrip(LEGACY_COMPETITIVE, "legacy-competitive");
    const ok = restored?.cardData?.source === "COMPETITIVE" && restored?.cardData?.payload?.ticker === "JOBY";
    allOk = allOk && ok;
    console.log(`${ok ? "✅" : "❌"} ${"COMPETITIVE*".padEnd(13)} legacy type:"competitive" → cardData  ·  ${projection.slice(0, 90)}`);
  } catch (e) {
    allOk = false;
    console.log(`❌ COMPETITIVE* legacy ${(e as Error).message}`);
  }

  console.log(allOk ? "\n✅ all source_card turns reload === live through Postgres" : "\n❌ some round-trips failed");
  process.exit(allOk ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
