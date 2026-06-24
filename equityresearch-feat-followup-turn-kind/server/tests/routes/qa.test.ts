// L2 behavior net for /general-qa. Proxies a free-form question to Perplexity
// (sonar) and returns a lightly HTML-formatted answer. Stubs env (Perplexity
// key) + global fetch to pin: no-key 503, the happy formatting path (strip [n]
// citations, bold, citations passthrough), and the upstream-failure 500. L1
// covers the missing-query 400.
//
// Run green against the inline code before extracting qa/* out of routes.ts;
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

describe("POST /general-qa (L2)", () => {
  it("returns 503 when the Perplexity key is not configured", async () => {
    vi.stubEnv("PERPLEXITY_API_KEY", "");
    const res = await request(app).post("/api/general-qa").send({ query: "what is a P/E ratio?" });
    expect(res.status).toBe(503);
    expect(res.body).toMatchObject({ success: false });
  });

  it("formats the Perplexity answer (strips [n], bolds, passes citations through)", async () => {
    vi.stubEnv("PERPLEXITY_API_KEY", "test-key");
    const fetchMock = stubFetch(async () =>
      new Response(
        JSON.stringify({
          choices: [{ message: { content: "A **P/E ratio** is price over earnings [1]." } }],
          citations: ["https://example.com/pe"],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    const res = await request(app).post("/api/general-qa").send({ query: "what is a P/E ratio?" });

    expect(res.status).toBe(200);
    expect(String(fetchMock.mock.calls[0][0])).toContain("api.perplexity.ai");
    expect(res.body).toMatchObject({ success: true, query: "what is a P/E ratio?" });
    expect(res.body.answer).toContain("<strong>P/E ratio</strong>");
    expect(res.body.answer).not.toContain("[1]");
    expect(res.body.citations).toEqual(["https://example.com/pe"]);
  });

  it("returns 500 when the Perplexity call fails", async () => {
    vi.stubEnv("PERPLEXITY_API_KEY", "test-key");
    stubFetch(async () => new Response("upstream boom", { status: 500 }));
    const res = await request(app).post("/api/general-qa").send({ query: "x" });

    expect(res.status).toBe(500);
    expect(res.body).toMatchObject({ success: false, error: "Failed to process question" });
  });
});
