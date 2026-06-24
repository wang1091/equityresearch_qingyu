// L2 behavior net for /recommend-stocks. Calls Perplexity, parses a JSON array
// of recommendations, and falls back to parseRecommendationsManually when the
// model doesn't return clean JSON. Stubs env (the Perplexity key) + global fetch
// to pin: the no-key 503 guard, the happy JSON path, the manual-parse fallback
// (which exercises the moved helper), and the upstream-failure 500. L1 covers
// the missing-industry 400.
//
// Run green against the inline code before extracting recommend/* out of
// routes.ts; must stay green after the move.
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

const perplexityContent = (content: string) =>
  new Response(JSON.stringify({ choices: [{ message: { content } }] }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });

describe("POST /recommend-stocks (L2)", () => {
  it("returns 503 when the Perplexity key is not configured", async () => {
    vi.stubEnv("PERPLEXITY_API_KEY", "");
    const res = await request(app).post("/api/recommend-stocks").send({ industry: "tech" });
    expect(res.status).toBe(503);
    expect(res.body).toMatchObject({ success: false });
  });

  it("parses a clean JSON array from Perplexity into recommendations", async () => {
    vi.stubEnv("PERPLEXITY_API_KEY", "test-key");
    const fetchMock = stubFetch(async () =>
      perplexityContent(
        '[{"symbol":"AAPL","name":"Apple","rationale":"a"},{"symbol":"MSFT","name":"Microsoft","rationale":"b"},{"symbol":"NVDA","name":"Nvidia","rationale":"c"}]',
      ),
    );
    const res = await request(app).post("/api/recommend-stocks").send({ industry: "tech" });

    expect(res.status).toBe(200);
    expect(String(fetchMock.mock.calls[0][0])).toContain("api.perplexity.ai");
    expect(res.body).toMatchObject({ success: true, industry: "tech" });
    expect(res.body.recommendations).toHaveLength(3);
    expect(res.body.recommendations[0].symbol).toBe("AAPL");
  });

  it("falls back to manual parsing when the model returns no JSON array", async () => {
    vi.stubEnv("PERPLEXITY_API_KEY", "test-key");
    stubFetch(async () =>
      perplexityContent("AAPL Apple - strong\nMSFT Microsoft - cloud\nNVDA Nvidia - AI leader"),
    );
    const res = await request(app).post("/api/recommend-stocks").send({ industry: "tech" });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.recommendations.length).toBeGreaterThan(0);
    expect(res.body.recommendations.map((r: any) => r.symbol)).toContain("AAPL");
  });

  it("returns 500 when the Perplexity call fails", async () => {
    vi.stubEnv("PERPLEXITY_API_KEY", "test-key");
    stubFetch(async () => new Response("upstream boom", { status: 500 }));
    const res = await request(app).post("/api/recommend-stocks").send({ industry: "tech" });

    expect(res.status).toBe(500);
    expect(res.body).toMatchObject({ success: false, error: "Failed to generate recommendations" });
  });
});
