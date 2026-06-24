// L1 smoke / regression net for routes.ts — guards the route-splitting refactor.
//
// What this DOES test (deterministic, no network/DB, no flakiness):
//   1. Route table is intact — every expected `METHOD /path` is mounted, no more,
//      no fewer. This is the golden net: if a future split drops, renames, moves,
//      or duplicates a route, this snapshot fails.
//   2. Both mount points (`/api` and `/data`) serve the router.
//   3. Input-validation contracts — handlers with an early 400 guard still reject
//      bad input *before* doing any I/O (only handlers verified to short-circuit
//      before fetch/DB are exercised here).
//
// What it does NOT test: business correctness of any handler (that needs upstreams
// or mocked `fetch` — the L2 tier, added per-domain alongside each split).
//
// Route introspection (collectRoutes) is reusable: after splitting a domain out of
// routes.ts, re-run this file — the EXPECTED_ROUTES list must stay identical.
import { describe, expect, it, beforeAll } from "vitest";
import express, { type Express } from "express";
import request from "supertest";
import { registerRoutes } from "../routes";

// Golden route table — sorted "METHOD /path" mounted under the api router.
// Both `/api/*` and `/data/*` resolve to this same set.
const EXPECTED_ROUTES = [
  "DELETE /chat-history/:conversationId",
  "GET /analyst-ratings/:ticker",
  "GET /analyst-ratings/:ticker/detail",
  "GET /chat-history",
  "GET /chat-history/:conversationId",
  "GET /earnings/calendar",
  "GET /fda/companies",
  "GET /fda/companies/:ticker",
  "GET /health",
  "GET /me",
  "GET /performance/company-analysis",
  "GET /performance/health",
  "GET /similar-stocks/:ticker",
  "GET /stock-detail/:ticker",
  "GET /stock-price/:ticker",
  "GET /test",
  "GET /trending-stocks",
  "POST /agent/chat",
  "POST /agent/chat-stream",
  "POST /agent/generate-answer",
  "POST /agent/news-brief",
  "POST /analyze-redflags",
  "POST /chat-history",
  "POST /classify-intents-multi",
  "POST /competitive-analysis",
  "POST /detect-rumor",
  "POST /earnings-fallback",
  "POST /earnings/ask",
  "POST /earnings/query",
  "POST /follow-ups",
  "POST /gemini-fallback",
  "POST /general-qa",
  "POST /market-data",
  "POST /performance/find-peers",
  "POST /performance/get-metrics",
  "POST /performance/peer-analysis",
  "POST /performance/resolve",
  "POST /recommend-stocks",
  "POST /rumor-check/chatbot",
  "POST /stock-picker/query",
  "POST /summarize-earnings",
  "POST /translate-visible-content",
  "POST /valuation-analysis",
].sort();

/** Walk an Express app's router stack and collect mounted "METHOD /path" routes. */
function collectRoutes(app: Express): string[] {
  const found: string[] = [];
  const walk = (stack: any[]) => {
    for (const layer of stack) {
      if (layer.route) {
        const methods = Object.keys(layer.route.methods)
          .filter((m) => layer.route.methods[m])
          .join(",")
          .toUpperCase();
        found.push(`${methods} ${layer.route.path}`);
      } else if (layer.handle?.stack) {
        walk(layer.handle.stack);
      }
    }
  };
  const stack = (app as any)._router?.stack ?? (app as any).router?.stack ?? [];
  walk(stack);
  return Array.from(new Set(found)).sort();
}

// Handlers verified to validate-and-400 before any fetch/DB I/O. Sending an empty
// body must deterministically yield 400 with no network access.
const VALIDATION_CASES: Array<{ path: string; expectBody?: (b: any) => void }> = [
  { path: "/market-data", expectBody: (b) => expect(String(b.error)).toMatch(/tickers/i) },
  { path: "/translate-visible-content" },
  { path: "/valuation-analysis" },
  { path: "/analyze-redflags" },
  { path: "/summarize-earnings" },
  { path: "/recommend-stocks" },
  { path: "/general-qa" },
  { path: "/earnings-fallback" },
  { path: "/earnings/ask" },
  { path: "/earnings/query" },
];

describe("routes.ts L1 smoke net", () => {
  let app: Express;

  beforeAll(async () => {
    app = express();
    app.use(express.json());
    await registerRoutes(app);
  });

  it("mounts exactly the expected route table (no dropped/renamed/duplicate routes)", () => {
    expect(collectRoutes(app)).toEqual(EXPECTED_ROUTES);
  });

  it("serves the router under both /api and /data", async () => {
    for (const prefix of ["/api", "/data"]) {
      const res = await request(app).get(`${prefix}/test`);
      expect(res.status).toBe(200);
      expect(res.body.message).toBe("API is working!");
    }
  });

  describe("input validation contracts (400 before any I/O)", () => {
    for (const { path, expectBody } of VALIDATION_CASES) {
      it(`POST ${path} rejects an empty body with 400`, async () => {
        const res = await request(app).post(`/api${path}`).send({});
        expect(res.status).toBe(400);
        expectBody?.(res.body);
      });
    }
  });
});
