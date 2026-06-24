// L2 behavior net for the /performance/* proxy endpoints.
//
// Drives the real app via registerRoutes() and stubs global fetch, so it asserts
// the upstream→HTTP mapping (which path is proxied, status passthrough, and the
// 503/502/400 error contracts) WITHOUT touching the network. Written before the
// extraction of these routes out of routes.ts and must stay green after it —
// that's how we prove the move changed no behavior.
import { describe, it, expect, beforeAll, afterEach, vi } from "vitest";
import express, { type Express } from "express";
import request from "supertest";
import { registerRoutes } from "../../routes";
import { __resetHttpClientStateForTests } from "../../../http/httpClient";

let app: Express;

beforeAll(async () => {
  app = express();
  app.use(express.json());
  await registerRoutes(app);
});

afterEach(() => {
  vi.unstubAllGlobals();
  // The proxy now fails over via the shared http client (per-host circuit
  // breaker). Reset its state between tests so accumulated failures from the
  // error-path cases don't open the circuit for later cases in this file.
  __resetHttpClientStateForTests();
});

/** Stub global fetch; returns the mock so tests can assert the proxied URL. */
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

describe("/performance/* proxy (L2)", () => {
  // Each POST proxy maps to a specific upstream path; happy path passes status+body through.
  const proxyCases: Array<{ route: string; upstreamPath: string }> = [
    { route: "/performance/resolve", upstreamPath: "/api/resolve" },
    { route: "/performance/find-peers", upstreamPath: "/api/find-peers" },
    { route: "/performance/get-metrics", upstreamPath: "/api/get-metrics" },
    { route: "/performance/peer-analysis", upstreamPath: "/api/peer-key-metrics-conclusion" },
  ];

  for (const { route, upstreamPath } of proxyCases) {
    it(`POST ${route} proxies to ${upstreamPath} and passes the upstream response through`, async () => {
      const fetchMock = stubFetch(async () => jsonRes({ ok: true, marker: route }, 200));
      const res = await request(app).post(`/api${route}`).send({ ticker: "NVDA" });

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ ok: true, marker: route });
      expect(String(fetchMock.mock.calls[0][0])).toContain(upstreamPath);
    });

    it(`POST ${route} → 503 with a startup hint when the upstream is unreachable`, async () => {
      stubFetch(async () => {
        throw new Error("ECONNREFUSED");
      });
      const res = await request(app).post(`/api${route}`).send({ ticker: "NVDA" });

      expect(res.status).toBe(503);
      expect(res.body.detail).toMatch(/ECONNREFUSED/);
      expect(String(res.body.hint)).toMatch(/performance service/i);
    });

    it(`POST ${route} → 502 when the upstream returns non-JSON`, async () => {
      stubFetch(async () => new Response("<html>502 Bad Gateway</html>", { status: 200 }));
      const res = await request(app).post(`/api${route}`).send({ ticker: "NVDA" });

      expect(res.status).toBe(502);
      expect(String(res.body.error)).toMatch(/invalid JSON/i);
    });
  }

  it("POST /performance/resolve passes the upstream status code through (e.g. 404)", async () => {
    stubFetch(async () => jsonRes({ error: "not found" }, 404));
    const res = await request(app).post("/api/performance/resolve").send({ q: "x" });
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: "not found" });
  });

  it("GET /performance/company-analysis requires a ticker (400, no upstream call)", async () => {
    const fetchMock = stubFetch(async () => jsonRes({}, 200));
    const res = await request(app).get("/api/performance/company-analysis");
    expect(res.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("GET /performance/company-analysis proxies ticker+peers+lang to primary-company-analysis", async () => {
    const fetchMock = stubFetch(async () => jsonRes({ ok: true }, 200));
    const res = await request(app)
      .get("/api/performance/company-analysis")
      .query({ ticker: "NVDA", peers: "AMD,INTC", lang: "zh" });

    expect(res.status).toBe(200);
    const calledUrl = String(fetchMock.mock.calls[0][0]);
    expect(calledUrl).toContain("/api/primary-company-analysis");
    expect(calledUrl).toContain("ticker=NVDA");
    expect(calledUrl).toContain("peers=AMD");
    expect(calledUrl).toContain("lang=zh");
  });

  it("GET /performance/health → connected when upstream is healthy", async () => {
    stubFetch(async () => jsonRes({ status: "healthy" }, 200));
    const res = await request(app).get("/api/performance/health");
    expect(res.status).toBe(200);
    expect(res.body.proxy_status).toBe("connected");
    expect(res.body.status).toBe("healthy");
  });

  it("GET /performance/health → 503 disconnected when upstream is down", async () => {
    stubFetch(async () => {
      throw new Error("ECONNREFUSED");
    });
    const res = await request(app).get("/api/performance/health");
    expect(res.status).toBe(503);
    expect(res.body.proxy_status).toBe("disconnected");
  });
});
