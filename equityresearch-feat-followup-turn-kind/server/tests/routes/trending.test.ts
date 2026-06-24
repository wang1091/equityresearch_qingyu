// L2 behavior net for /trending-stocks. Proxies the trending upstream, with a
// category variant that hits a different path. Stubs global fetch to pin: the
// happy passthrough + URL (plain vs ?category=), upstream-status passthrough,
// and the 502-on-throw contract. No 400 guard, so this is its only net besides
// the L1 route-table golden.
//
// Run green against the inline code before extracting trending/* out of
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

describe("GET /trending-stocks (L2)", () => {
  it("proxies the plain trending endpoint and wraps the result", async () => {
    const fetchMock = stubFetch(async () => jsonRes({ items: [1, 2] }));
    const res = await request(app).get("/api/trending-stocks");

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ success: true, items: [1, 2] });
    expect(String(fetchMock.mock.calls[0][0])).toContain("/api/trending");
  });

  it("uses the category path when ?category= is given", async () => {
    const fetchMock = stubFetch(async () => jsonRes({ items: [] }));
    const res = await request(app).get("/api/trending-stocks").query({ category: "ai" });

    expect(res.status).toBe(200);
    expect(String(fetchMock.mock.calls[0][0])).toContain("/api/stock-picker/trending/ai");
  });

  it("passes an upstream error status through", async () => {
    stubFetch(async () => jsonRes({ error: "x" }, 503));
    const res = await request(app).get("/api/trending-stocks");
    expect(res.status).toBe(503);
    expect(res.body).toMatchObject({ success: false });
  });

  it("maps a thrown upstream error to 502", async () => {
    stubFetch(async () => {
      throw new Error("trending down");
    });
    const res = await request(app).get("/api/trending-stocks");
    expect(res.status).toBe(502);
    expect(res.body).toMatchObject({ success: false });
  });
});
