// L2 behavior net for /analyze-redflags. Calls DeepSeek to score news red flags
// and returns parsed JSON. Note the graceful contract: missing key and any error
// both return HTTP 200 success:true (with a fallback summary), never 4xx/5xx —
// only the missing ticker/newsContent case is 400 (covered by L1). Stubs env
// (DeepSeek key) + global fetch to pin those paths with no network.
//
// Run green against the inline code before extracting redflags/* out of
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

const deepSeekContent = (content: string) =>
  new Response(JSON.stringify({ choices: [{ message: { content } }] }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });

const body = { ticker: "NVDA", newsContent: "some news about NVDA" };

describe("POST /analyze-redflags (L2)", () => {
  it("returns a graceful success when no DeepSeek key is configured (no upstream call)", async () => {
    vi.stubEnv("DEEPSEEK_API_KEY", "");
    vi.stubEnv("DEEPSEEK_KEY", "");
    const fetchMock = stubFetch(async () => deepSeekContent("{}"));
    const res = await request(app).post("/api/analyze-redflags").send(body);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ success: true, redflag_count: 0, severity: "unknown" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("parses the DeepSeek JSON into a red-flag verdict", async () => {
    vi.stubEnv("DEEPSEEK_API_KEY", "test-key");
    const fetchMock = stubFetch(async () =>
      deepSeekContent('{"redflag_count":2,"severity":"high","summary":"litigation risk"}'),
    );
    const res = await request(app).post("/api/analyze-redflags").send(body);

    expect(res.status).toBe(200);
    expect(String(fetchMock.mock.calls[0][0])).toContain("api.deepseek.com");
    expect(res.body).toMatchObject({
      success: true,
      ticker: "NVDA",
      redflag_count: 2,
      severity: "high",
      summary: "litigation risk",
    });
  });

  it("degrades gracefully (HTTP 200, success:true) when the upstream fails", async () => {
    vi.stubEnv("DEEPSEEK_API_KEY", "test-key");
    vi.stubEnv("GEMINI_API_KEY", "");
    stubFetch(async () => new Response("boom", { status: 500 }));
    const res = await request(app).post("/api/analyze-redflags").send(body);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ success: true, severity: "unknown", summary: "Analysis failed" });
  });

  it("fails over to Gemini when DeepSeek returns 402 (out of balance)", async () => {
    vi.stubEnv("DEEPSEEK_API_KEY", "test-key");
    vi.stubEnv("GEMINI_API_KEY", "gem-key");
    const fetchMock = stubFetch(async (url: string) => {
      if (String(url).includes("api.deepseek.com")) {
        return new Response("Insufficient Balance", { status: 402 });
      }
      // Gemini generateContent shape
      return new Response(
        JSON.stringify({
          candidates: [
            {
              content: { parts: [{ text: '{"redflag_count":1,"severity":"medium","summary":"supply risk"}' }] },
              finishReason: "STOP",
            },
          ],
        }),
        { status: 200 },
      );
    });

    const res = await request(app).post("/api/analyze-redflags").send(body);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ success: true, redflag_count: 1, severity: "medium", summary: "supply risk" });
    // primary DeepSeek hit first, then Gemini fallback
    expect(String(fetchMock.mock.calls[0][0])).toContain("api.deepseek.com");
    expect(String(fetchMock.mock.calls[1][0])).toContain("generativelanguage");
  });
});
