// L2 behavior net for /valuation-analysis. The endpoint proxies the Python DCF
// service and maps its response into the card payload. Note the contract: only
// the missing-ticker case is 4xx (400, covered by L1); upstream failure and
// thrown errors both return HTTP 200 with success:false. This stubs global fetch
// to pin that mapping with no network.
//
// Run green against the inline code before extracting valuation/* out of
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
});

function stubFetch(impl: (url: string, init?: any) => Promise<Response>) {
  const fn = vi.fn(impl);
  vi.stubGlobal("fetch", fn);
  return fn;
}

const jsonRes = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

const dcfPayload = {
  ticker: "NVDA",
  current_price: 100,
  target_price: 130,
  upside_percentage: "30",
  confidence: 0.8,
  method: "DCF",
  verdict: "Undervalued",
  rationale: "strong FCF growth",
  details: { dcf_valuation: { x: 1 }, relative_valuation: { y: 2 } },
};

describe("POST /valuation-analysis (L2)", () => {
  it("proxies to the Python DCF service and maps a successful valuation", async () => {
    const fetchMock = stubFetch(async () => jsonRes(dcfPayload, 200));
    const res = await request(app).post("/api/valuation-analysis").send({ ticker: "NVDA" });

    expect(res.status).toBe(200);
    expect(String(fetchMock.mock.calls[0][0])).toContain("/api/full-valuation");
    expect(res.body).toMatchObject({
      success: true,
      ticker: "NVDA",
      ai_recommendation: { chosen_method: "DCF", verdict: "Undervalued" },
      ai_fallback_used: false,
    });
  });

  it("returns success:false (HTTP 200) when the DCF service errors", async () => {
    stubFetch(async () => jsonRes({ error: "boom" }, 500));
    const res = await request(app).post("/api/valuation-analysis").send({ ticker: "NVDA" });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      success: false,
      ticker: "NVDA",
      error: "Valuation service unavailable",
    });
  });

  it("returns success:false (HTTP 200) when the upstream call throws", async () => {
    stubFetch(async () => {
      throw new Error("ECONNREFUSED");
    });
    const res = await request(app).post("/api/valuation-analysis").send({ ticker: "NVDA" });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ success: false, error: "Analysis failed" });
  });
});
