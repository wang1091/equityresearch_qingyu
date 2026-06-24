// Breadth E2E across ALL /api endpoints (the routes.smoke.test.ts golden set).
// Sends ONE real request per endpoint through the mounted router and asserts the
// response is the handler's own contract — route wired, handler ran, shape right.
// This is wiring/contract coverage, NOT deep correctness (that needs stable
// upstreams). Complements agentPipeline.e2e.test.ts (one endpoint, deep).
//
// GATED + skipped by default (needs the live stack); never runs in CI.
//   E2E_LOCAL=1 npx vitest run --root . server/tests/e2e/endpoints.e2e.test.ts
//
// DATABASE SAFETY: the 4 chat-history endpoints are Postgres-backed and sit
// behind the `requireAuth` middleware, which returns 401 BEFORE the handler's DB
// query. We send them WITHOUT an auth header and assert 401 — so the DB is never
// touched. /me is header-only (no DB) and is exercised normally. No other
// endpoint touches Postgres.
//
// Assertions are tolerant by design: each case lists the status codes its handler
// may legitimately return (200, or 4xx guards, or 502/503 when a proxied upstream
// is down). A 404 route-missing or an unhandled crash falls outside those sets
// and fails. When a 200 comes back we also check the documented top-level key.
import { describe, it, expect, beforeAll } from "vitest";
import express, { type Express } from "express";
import request from "supertest";
import { config as loadEnv } from "dotenv";
import { registerRoutes } from "../../routes";

const E2E = process.env.E2E_LOCAL === "1";
const suite = E2E ? describe : describe.skip;

type Method = "get" | "post" | "delete";
interface Case {
  name: string;
  method: Method;
  path: string;
  body?: Record<string, unknown>;
  headers?: Record<string, string>;
  status: number[]; // acceptable status codes
  key?: string; // top-level body key required when status === 200
  group: "core" | "agent" | "llm" | "proxy" | "quotes" | "db";
}

const AAPL = "AAPL";

const CASES: Case[] = [
  // ── core / utility ──────────────────────────────────────────────────────────
  { group: "core", name: "GET /test", method: "get", path: "/api/test", status: [200], key: "message" },
  { group: "core", name: "GET /health", method: "get", path: "/api/health", status: [200, 503], key: "status" },

  // ── agent pipeline (local LLM) ───────────────────────────────────────────────
  { group: "agent", name: "POST /agent/chat", method: "post", path: "/api/agent/chat",
    body: { conversationId: `e2e-${Date.now()}-1`, message: "AAPL stock price today", language: "en" }, status: [200], key: "answer" },
  { group: "agent", name: "POST /agent/chat-stream", method: "post", path: "/api/agent/chat-stream",
    body: { conversationId: `e2e-${Date.now()}-2`, message: "AAPL stock price today", language: "en" }, status: [200] },
  { group: "agent", name: "POST /agent/generate-answer", method: "post", path: "/api/agent/generate-answer",
    body: { conversationId: `e2e-${Date.now()}-3`, query: "What is a P/E ratio?", language: "en" }, status: [200], key: "answer" },
  { group: "agent", name: "POST /agent/news-brief", method: "post", path: "/api/agent/news-brief",
    body: { newsContent: "Apple reported record iPhone revenue and raised guidance for the next quarter.", ticker: AAPL, language: "en" }, status: [200], key: "success" },

  // ── LLM / inference ─────────────────────────────────────────────────────────
  { group: "llm", name: "POST /classify-intents-multi", method: "post", path: "/api/classify-intents-multi",
    body: { query: "AAPL valuation", language: "en" }, status: [200], key: "required_data" },
  { group: "llm", name: "POST /valuation-analysis", method: "post", path: "/api/valuation-analysis",
    body: { ticker: AAPL, query: "Is AAPL overvalued?" }, status: [200], key: "ticker" },
  { group: "llm", name: "POST /analyze-redflags", method: "post", path: "/api/analyze-redflags",
    body: { ticker: "NVDA", newsContent: "NVIDIA faces export restrictions and supply constraints." }, status: [200], key: "success" },
  { group: "llm", name: "POST /summarize-earnings", method: "post", path: "/api/summarize-earnings",
    body: { ticker: "TSLA", earningsContent: "Tesla reported Q3 results with record deliveries, improving margins, and reiterated full-year guidance for vehicle production." }, status: [200], key: "success" },
  { group: "llm", name: "POST /earnings-fallback", method: "post", path: "/api/earnings-fallback",
    body: { query: "What should I know about Apple's latest earnings?" }, status: [200, 503], key: "success" },
  { group: "llm", name: "POST /recommend-stocks", method: "post", path: "/api/recommend-stocks",
    body: { industry: "semiconductor" }, status: [200, 503], key: "success" },
  { group: "llm", name: "POST /general-qa", method: "post", path: "/api/general-qa",
    body: { query: "What is the current state of AI in healthcare?" }, status: [200, 503], key: "success" },
  { group: "llm", name: "POST /gemini-fallback", method: "post", path: "/api/gemini-fallback",
    body: { query: "Outlook for AI stocks in 2025", language: "en" }, status: [200, 502, 503] },
  { group: "llm", name: "POST /follow-ups", method: "post", path: "/api/follow-ups",
    body: { user_question: "What is AAPL's valuation?", agent_answer: "AAPL trades at a forward P/E near 28, modestly above its 5-year average.", ticker: AAPL, language: "en" }, status: [200, 503], key: "success" },
  { group: "llm", name: "POST /competitive-analysis", method: "post", path: "/api/competitive-analysis",
    body: { ticker: AAPL, company: "Apple" }, status: [200, 400, 502, 503] },
  { group: "llm", name: "POST /market-data", method: "post", path: "/api/market-data",
    body: { tickers: [AAPL, "MSFT"], queryType: "price", lang: "en" }, status: [200], key: "success" },

  // ── proxied upstreams (data services) ────────────────────────────────────────
  { group: "proxy", name: "GET /fda/companies", method: "get", path: "/api/fda/companies", status: [200, 502, 503] },
  { group: "proxy", name: "GET /fda/companies/:ticker", method: "get", path: "/api/fda/companies/AMGN", status: [200, 404, 502, 503] },
  { group: "proxy", name: "GET /earnings/calendar", method: "get", path: "/api/earnings/calendar", status: [200, 502, 503], key: "success" },
  { group: "proxy", name: "POST /earnings/ask", method: "post", path: "/api/earnings/ask",
    body: { ticker: AAPL, question: "What were the main product updates last quarter?" }, status: [200, 404, 502, 503] },
  { group: "proxy", name: "POST /earnings/query", method: "post", path: "/api/earnings/query",
    body: { ticker: AAPL, topic: "summary", lang: "en" }, status: [200, 404, 502, 503] },
  // Opaque proxies: their contract is "faithfully forward the upstream response",
  // so an upstream 4xx (e.g. a body our fixture didn't match) passed through is a
  // WORKING proxy, not a wiring failure — hence 400 is acceptable here.
  { group: "proxy", name: "POST /performance/resolve", method: "post", path: "/api/performance/resolve",
    body: { ticker: AAPL, company: "Apple Inc" }, status: [200, 400, 502, 503] },
  { group: "proxy", name: "POST /performance/find-peers", method: "post", path: "/api/performance/find-peers",
    body: { ticker: AAPL }, status: [200, 502, 503] },
  { group: "proxy", name: "POST /performance/get-metrics", method: "post", path: "/api/performance/get-metrics",
    body: { tickers: [AAPL] }, status: [200, 502, 503] },
  { group: "proxy", name: "POST /performance/peer-analysis", method: "post", path: "/api/performance/peer-analysis",
    body: { ticker: AAPL }, status: [200, 400, 502, 503] },
  { group: "proxy", name: "GET /performance/company-analysis", method: "get", path: "/api/performance/company-analysis?ticker=AAPL&lang=en", status: [200, 502, 503] },
  { group: "proxy", name: "GET /performance/health", method: "get", path: "/api/performance/health", status: [200, 503] },
  { group: "proxy", name: "POST /rumor-check/chatbot", method: "post", path: "/api/rumor-check/chatbot",
    body: { query: "Is TSLA being acquired?", language: "en" }, status: [200, 500, 502, 503] },
  { group: "proxy", name: "POST /detect-rumor", method: "post", path: "/api/detect-rumor",
    body: { query: "Is TSLA being acquired?", language: "en" }, status: [200, 500, 502, 503] },
  { group: "proxy", name: "GET /trending-stocks", method: "get", path: "/api/trending-stocks?lang=en", status: [200, 502, 503] },
  { group: "proxy", name: "POST /stock-picker/query", method: "post", path: "/api/stock-picker/query",
    body: { ticker: AAPL, lang: "en" }, status: [200, 502, 503] },
  { group: "proxy", name: "POST /translate-visible-content", method: "post", path: "/api/translate-visible-content",
    body: { targetLanguage: "zh", mode: "plain", payload: "Apple beat earnings expectations." }, status: [200, 503], key: "success" },

  // ── quotes (Yahoo / FMP) ─────────────────────────────────────────────────────
  { group: "quotes", name: "GET /stock-detail/:ticker", method: "get", path: "/api/stock-detail/AAPL", status: [200, 502, 503], key: "success" },
  { group: "quotes", name: "GET /stock-price/:ticker", method: "get", path: "/api/stock-price/AAPL?range=1mo&interval=1d", status: [200, 502, 503], key: "success" },
  { group: "quotes", name: "GET /similar-stocks/:ticker", method: "get", path: "/api/similar-stocks/AAPL", status: [200, 502, 503], key: "success" },
  { group: "quotes", name: "GET /analyst-ratings/:ticker", method: "get", path: "/api/analyst-ratings/NVDA", status: [200, 502, 503], key: "success" },
  { group: "quotes", name: "GET /analyst-ratings/:ticker/detail", method: "get", path: "/api/analyst-ratings/MSFT/detail", status: [200, 502, 503], key: "success" },

  // ── DB endpoints: GUARD-ONLY (requireAuth → 401 before any DB query) ──────────
  { group: "db", name: "GET /chat-history (no auth → 401, no DB)", method: "get", path: "/api/chat-history", status: [401] },
  { group: "db", name: "GET /chat-history/:id (no auth → 401, no DB)", method: "get", path: "/api/chat-history/e2e-x", status: [401] },
  { group: "db", name: "POST /chat-history (no auth → 401, no DB)", method: "post", path: "/api/chat-history",
    body: { conversationId: "e2e-x", messages: [] }, status: [401] },
  { group: "db", name: "DELETE /chat-history/:id (no auth → 401, no DB)", method: "delete", path: "/api/chat-history/e2e-x", status: [401] },
  // /me is header-only (no DB) — exercise the happy path with an auth header.
  { group: "db", name: "GET /me (header-only, no DB)", method: "get", path: "/api/me", headers: { "x-auth-user": "e2e-user" }, status: [200], key: "userId" },
];

suite("all /api endpoints — breadth E2E (live stack, no DB writes)", () => {
  let app: Express;

  beforeAll(async () => {
    loadEnv({ path: ".env.local" });
    loadEnv({ path: ".env" });
    app = express();
    app.use(express.json());
    await registerRoutes(app);
  });

  it.each(CASES)("$name", async (c) => {
    let req = request(app)[c.method](c.path);
    if (c.headers) req = req.set(c.headers);
    if (c.body) req = req.send(c.body);
    const res = await req;

    // route wired + handler ran with a contract-valid status
    expect(c.status, `${c.name} → unexpected status ${res.status}`).toContain(res.status);
    // documented success key present on a 200
    if (res.status === 200 && c.key) {
      expect(res.body, `${c.name} → 200 missing key "${c.key}"`).toHaveProperty(c.key);
    }
  }, 120_000);
});
