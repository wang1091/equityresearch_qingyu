// TRUE end-to-end test of the agent pipeline through the real HTTP route:
//   POST /api/agent/chat  →  classify → callApis → generate → JSON response
//
// Unlike chat.e2e.test.ts (which mocks each stage), this runs the WHOLE pipeline
// for real. It is GATED and SKIPPED by default — it needs a local stack up, so it
// must never run in normal `vitest run` / CI. It does NOT touch Postgres: the
// agent pipeline keeps conversation history in-memory (server/agent/conversation.ts),
// so no DB is involved on this path at all.
//
// ── How to run ────────────────────────────────────────────────────────────────
// Just enable the gate — the test loads your local .env itself (vitest does NOT
// run server/index.ts's env bootstrap, so we replicate it here, gated):
//
//     E2E_LOCAL=1 npx vitest run --root . server/tests/e2e/agentPipeline.e2e.test.ts
//
// It then uses your .env as-is: CLASSIFIER_LLM_BASE_URL (local qwen) for routing,
// DeepSeek for generation (DEEPSEEK_API_KEY), and the local data upstreams (which
// fall back to the public domains if a local service is down — resolveUpstreamBases).
// To run generation on the local model too, set CHAT_LLM_BASE_URL (or LLM_BASE_URL).
//
// The default query ("AAPL stock price today") routes to STOCK_PRICE / MARKET_DATA
// — the lightest upstreams. It does NOT touch Postgres (the agent pipeline keeps
// history in-memory), even though .env sets DATABASE_URL.
import { describe, it, expect, beforeAll, vi } from "vitest";
import express, { type Express } from "express";
import request from "supertest";
import { config as loadEnv } from "dotenv";
import { registerRoutes } from "../../routes";
import { logger } from "../../utils";
import { resolveChatChain } from "../../llm/chat";
import { resolveClassifierLlm } from "../../agent/classifier";

// Structured events that mean the pipeline switched AWAY from its primary
// (local) provider — i.e. it did NOT actually run on the local LLM. Inferred
// from the unified fallback/failover events. generator.fallback:parse_raw is
// deliberately excluded: that means the local model WAS used but emitted
// non-structured output (a quality issue, not a provider switch).
const SWITCHED_AWAY = new Set([
  "classifier.failover",
  "classifier.fallback",
  "chat.failover",
  "chat.stream.failover",
  "generator.failover",
]);
const isSwitchAway = (event: unknown, cause: unknown) =>
  SWITCHED_AWAY.has(String(event)) ||
  (event === "generator.fallback" && cause === "chain_failed");

const E2E = process.env.E2E_LOCAL === "1";
// describe.skip when the gate is off, so the default suite stays green/offline.
const suite = E2E ? describe : describe.skip;

suite("agent pipeline E2E (local LLM, real upstreams, no DB)", () => {
  let app: Express;

  beforeAll(async () => {
    // Load .env like the dev server does (vitest skips server/index.ts). Most
    // specific first; dotenv won't override already-set vars, so .env.local wins
    // over .env, and anything passed on the CLI (E2E_LOCAL) wins over both. All
    // the envs this path needs are read at request time (resolveClassifierLlm /
    // resolveChatChain / resolveUpstreamBases), so loading here is in time.
    loadEnv({ path: ".env.local" });
    loadEnv({ path: ".env" });

    app = express();
    app.use(express.json());
    await registerRoutes(app);
  });

  it(
    "POST /agent/chat: query → classify → callApis → generate → response",
    async () => {
      // Explicit ticker in the query so the route doesn't depend on a (possibly
      // weak) local model resolving a company name → ticker.
      const res = await request(app)
        .post("/api/agent/chat")
        .send({
          conversationId: `e2e-${Date.now()}`,
          message: "AAPL stock price today",
          language: "en",
        });

      expect(res.status).toBe(200);
      // pipeline produced an answer
      expect(res.body.success).toBe(true);
      expect(typeof res.body.answer).toBe("string");
      expect(res.body.answer.length).toBeGreaterThan(0);
      // classifier ran and routed to at least one data source
      expect(Array.isArray(res.body.metadata?.requiredData)).toBe(true);
      expect(res.body.metadata.requiredData.length).toBeGreaterThan(0);
      // ticker was extracted and carried through to the response metadata
      expect(res.body.metadata.tickers).toContain("AAPL");
    },
    120_000, // real LLM + upstreams are slow; generous budget
  );

  it(
    "runs entirely on the LOCAL LLM (no provider failover/fallback)",
    async () => {
      // Config sanity — this only proves "local" when the chain is pointed there.
      // Fails loudly if .env points the chat chain or classifier at a remote host.
      expect(resolveChatChain()[0]?.id).toBe("local-llm");
      expect(resolveClassifierLlm().baseUrl).toMatch(/localhost|127\.0\.0\.1/);

      // vi.spyOn calls through, so logging still happens; we just capture calls.
      const warn = vi.spyOn(logger, "warn");
      const error = vi.spyOn(logger, "error");

      const res = await request(app)
        .post("/api/agent/chat")
        .send({
          conversationId: `e2e-local-${Date.now()}`,
          message: "AAPL stock price today",
          language: "en",
        });
      expect(res.status).toBe(200);

      const switchedAway = [...warn.mock.calls, ...error.mock.calls]
        .map((c) => ({ event: c[0], cause: (c[1] as any)?.cause }))
        .filter((e) => isSwitchAway(e.event, e.cause));

      warn.mockRestore();
      error.mockRestore();

      // Empty ⇒ both classifier and generator stayed on their local primary.
      // A non-empty array names exactly which stage fell back to a remote.
      expect(switchedAway).toEqual([]);
    },
    120_000,
  );
});
