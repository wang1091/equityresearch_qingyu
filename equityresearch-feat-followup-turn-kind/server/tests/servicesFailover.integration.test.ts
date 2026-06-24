// Per-service integration tests for the upstream failover requirement:
// "if the internal localhost service is down, fall over to the (public) URL".
//
// Mirrors upstreamFailover.integration.test.ts (real local HTTP stubs + a dead
// port → real ECONNREFUSED), but drives each MIGRATED service through its own
// public entry point: the route handlers via supertest, and the stock-picker
// service function directly. The primary base is pointed at a dead port and the
// *_FALLBACK_URL at a live stub, so each test exercises local-down → public.
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import http from "node:http";
import express, { type Express } from "express";
import request from "supertest";
import { registerRoutes } from "../routes";
import { fetchStockPickerCard } from "../stockPicker/service";
import { __resetHttpClientStateForTests } from "../../http/httpClient";

type Stub = { server: http.Server; port: number; hits: number };

/** Start a real HTTP server on an ephemeral port with the given JSON responder. */
function startStub(
  respond: (req: http.IncomingMessage) => { status: number; body: unknown },
): Promise<Stub> {
  return new Promise((resolve) => {
    const stub: Partial<Stub> & { hits: number } = { hits: 0 };
    const server = http.createServer((req, res) => {
      stub.hits++;
      const { status, body } = respond(req);
      res.writeHead(status, { "Content-Type": "application/json" });
      res.end(JSON.stringify(body));
    });
    server.listen(0, "127.0.0.1", () => {
      stub.server = server;
      stub.port = (server.address() as { port: number }).port;
      resolve(stub as Stub);
    });
  });
}

/** A port with nothing listening → connect yields ECONNREFUSED ("down"). */
function deadPort(): Promise<number> {
  return new Promise((resolve) => {
    const s = http.createServer();
    s.listen(0, "127.0.0.1", () => {
      const port = (s.address() as { port: number }).port;
      s.close(() => resolve(port));
    });
  });
}

const openStubs: http.Server[] = [];
const envBackup: Record<string, string | undefined> = {};

function track(stub: Stub) {
  openStubs.push(stub.server);
  return stub;
}

/** Set env keys for one test, remembering originals for afterEach restore. */
function setEnv(vars: Record<string, string>) {
  for (const [k, v] of Object.entries(vars)) {
    if (!(k in envBackup)) envBackup[k] = process.env[k];
    process.env[k] = v;
  }
}

afterEach(() => {
  openStubs.splice(0).forEach((s) => s.close());
  for (const [k, v] of Object.entries(envBackup)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
    delete envBackup[k];
  }
  __resetHttpClientStateForTests();
});

let app: Express;
beforeAll(async () => {
  app = express();
  app.use(express.json());
  await registerRoutes(app);
});

describe("upstream failover per service: local down → public URL", () => {
  it("TRENDING: /trending-stocks falls over to the public base", async () => {
    const dead = await deadPort();
    const pub = track(await startStub(() => ({ status: 200, body: { items: [1, 2], via: "public" } })));
    setEnv({
      TRENDING_API_URL: `http://127.0.0.1:${dead}`,
      TRENDING_FALLBACK_URL: `http://127.0.0.1:${pub.port}`,
    });

    const res = await request(app).get("/api/trending-stocks");
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ success: true, via: "public", items: [1, 2] });
    expect(pub.hits).toBeGreaterThanOrEqual(1);
  });

  it("FDA: /fda/companies/:ticker falls over to the public base", async () => {
    const dead = await deadPort();
    const pub = track(await startStub(() => ({ status: 200, body: { ticker: "NVDA", via: "public" } })));
    setEnv({
      FDA_API_BASE_URL: `http://127.0.0.1:${dead}`,
      FDA_FALLBACK_URL: `http://127.0.0.1:${pub.port}`,
    });

    const res = await request(app).get("/api/fda/companies/NVDA");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ticker: "NVDA", via: "public" });
    expect(pub.hits).toBe(1);
  });

  it("PERFORMANCE: /performance/resolve falls over to the public base", async () => {
    const dead = await deadPort();
    const pub = track(await startStub(() => ({ status: 200, body: { resolved: true, via: "public" } })));
    setEnv({
      PERFORMANCE_API_URL: `http://127.0.0.1:${dead}`,
      PERFORMANCE_FALLBACK_URL: `http://127.0.0.1:${pub.port}`,
    });

    const res = await request(app).post("/api/performance/resolve").send({ ticker: "NVDA" });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ resolved: true, via: "public" });
    expect(pub.hits).toBe(1);
  });

  it("RUMOR: chatbot down → legacy fallback answers (tagged proxy_source)", async () => {
    const dead = await deadPort();
    const pub = track(await startStub(() => ({ status: 200, body: { verdict: "UNVERIFIED" } })));
    setEnv({
      RUMOR_CHATBOT_INTERNAL_URL: `http://127.0.0.1:${dead}`,
      RUMOR_LEGACY_FALLBACK_URL: `http://127.0.0.1:${pub.port}`,
    });

    const res = await request(app).post("/api/rumor-check/chatbot").send({ query: "is X true?" });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ verdict: "UNVERIFIED", proxy_source: "legacy_detect_rumor" });
    expect(pub.hits).toBe(1);
  });

  it("STOCK_PICKER: per-ticker call falls over to the public base", async () => {
    const dead = await deadPort();
    const pub = track(
      await startStub(() => ({ status: 200, body: { ticker: "TEST", finalScore: 7 } })),
    );
    setEnv({
      STOCK_PICKER_API_URL: `http://127.0.0.1:${dead}`,
      STOCK_PICKER_FALLBACK_URL: `http://127.0.0.1:${pub.port}`,
    });

    const payload = await fetchStockPickerCard({ tickers: ["TEST"], lang: "en" });
    expect(payload.results).toHaveLength(1);
    expect(payload.results[0].finalScore).toBe(7);
    expect(pub.hits).toBe(1);
  });
});
