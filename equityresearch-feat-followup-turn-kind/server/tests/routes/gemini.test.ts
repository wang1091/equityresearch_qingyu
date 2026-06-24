// L2 behavior net for /gemini-fallback. Tries Gemini (Google Search grounding)
// then Perplexity, and renders the model text into an HTML card. Stubs env
// (GEMINI_API_KEY / PERPLEXITY_API_KEY) + global fetch to pin: missing-query
// 400, no-keys 503, the Gemini happy path, and the both-unavailable 502.
//
// Run green against the inline code before extracting gemini/* out of routes.ts;
// must stay green after the move.
import { describe, it, expect, beforeAll, afterEach, vi } from "vitest";
import express, { type Express } from "express";
import request from "supertest";
import { registerRoutes } from "../../routes";

let app: Express;

beforeAll(async () => {
  app = express();
  app.use(express.json());
  await registerRoutes(app);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

function stubFetch(impl: (url: string, init?: any) => Promise<Response>) {
  const fn = vi.fn(impl);
  vi.stubGlobal("fetch", fn);
  return fn;
}

const geminiRes = (text: string, status = 200) =>
  new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text }] } }] }), {
    status,
    headers: { "content-type": "application/json" },
  });

describe("POST /gemini-fallback (L2)", () => {
  it("requires a query (400)", async () => {
    const res = await request(app).post("/api/gemini-fallback").send({});
    expect(res.status).toBe(400);
  });

  it("returns 503 when neither Gemini nor Perplexity is configured", async () => {
    vi.stubEnv("GEMINI_API_KEY", "");
    vi.stubEnv("PERPLEXITY_API_KEY", "");
    const res = await request(app).post("/api/gemini-fallback").send({ query: "analyze NVDA" });
    expect(res.status).toBe(503);
    expect(res.body).toMatchObject({ success: false });
  });

  it("renders the Gemini response into HTML content", async () => {
    vi.stubEnv("GEMINI_API_KEY", "gem-key");
    const fetchMock = stubFetch(async () => geminiRes("NVDA looks strong on AI demand."));
    const res = await request(app).post("/api/gemini-fallback").send({ query: "analyze NVDA" });

    expect(res.status).toBe(200);
    expect(String(fetchMock.mock.calls[0][0])).toContain("generativelanguage.googleapis.com");
    expect(res.body.success).toBe(true);
    expect(res.body.content).toContain("NVDA looks strong on AI demand.");
  });

  it("returns 502 when Gemini fails and no Perplexity fallback is configured", async () => {
    vi.stubEnv("GEMINI_API_KEY", "gem-key");
    vi.stubEnv("PERPLEXITY_API_KEY", "");
    stubFetch(async () => new Response("gemini boom", { status: 500 }));
    const res = await request(app).post("/api/gemini-fallback").send({ query: "analyze NVDA" });

    expect(res.status).toBe(502);
    expect(res.body).toMatchObject({ success: false });
  });
});
