// L2 behavior net for the FDA proxy endpoints (/fda/companies/:ticker and
// /fda/companies, with optional ?company= search). Both are thin pass-throughs
// to the FDA upstream; this stubs global fetch to pin the proxied URL, the JSON
// passthrough, and the 500-on-throw contract. Neither has a 400 guard, so this
// is their only net besides the L1 route-table golden.
//
// Run green against the inline code before extracting fda/* out of routes.ts;
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

describe("FDA proxy endpoints (L2)", () => {
  it("GET /fda/companies/:ticker proxies to /api/companies/:ticker and passes JSON through", async () => {
    const fetchMock = stubFetch(async () => jsonRes({ ticker: "NVDA", trials: 3 }));
    const res = await request(app).get("/api/fda/companies/NVDA");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ticker: "NVDA", trials: 3 });
    expect(String(fetchMock.mock.calls[0][0])).toContain("/api/companies/NVDA");
  });

  it("GET /fda/companies (no query) hits the plain companies endpoint", async () => {
    const fetchMock = stubFetch(async () => jsonRes([{ company: "Pfizer" }]));
    const res = await request(app).get("/api/fda/companies");

    expect(res.status).toBe(200);
    const url = String(fetchMock.mock.calls[0][0]);
    expect(url).toContain("/api/companies");
    expect(url).not.toContain("/search");
  });

  it("GET /fda/companies?company=X uses the search endpoint with the encoded company", async () => {
    const fetchMock = stubFetch(async () => jsonRes([]));
    const res = await request(app).get("/api/fda/companies").query({ company: "Eli Lilly" });

    expect(res.status).toBe(200);
    const url = String(fetchMock.mock.calls[0][0]);
    expect(url).toContain("/api/companies/search?company=Eli%20Lilly");
  });

  it("maps an upstream failure to 500", async () => {
    stubFetch(async () => {
      throw new Error("fda down");
    });
    const res = await request(app).get("/api/fda/companies/NVDA");
    expect(res.status).toBe(500);
    expect(res.body).toHaveProperty("error");
  });
});
