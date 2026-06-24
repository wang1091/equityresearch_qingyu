// L2 behavior net for the rumor endpoints (/rumor-check/chatbot + its
// backward-compat alias /detect-rumor). Both proxy through proxyRumorChatbot to
// the rumor upstream; this stubs global fetch to pin the proxy contract (JSON
// passthrough + proxy_source tag, and 500 on upstream failure / non-JSON) with
// no network. Neither endpoint has a pre-I/O 400 guard, so this is their only
// net besides the L1 route-table golden.
//
// Run green against the inline code before extracting rumor/* out of routes.ts;
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

describe("rumor endpoints (L2)", () => {
  for (const route of ["/rumor-check/chatbot", "/detect-rumor"]) {
    it(`POST ${route} passes the upstream JSON through and tags proxy_source`, async () => {
      stubFetch(async () => jsonRes({ verdict: "UNVERIFIED" }, 200));
      const res = await request(app).post(`/api${route}`).send({ query: "is X true?" });

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ verdict: "UNVERIFIED" });
      expect(typeof res.body.proxy_source).toBe("string");
    });

    it(`POST ${route} → 500 when the upstream is unreachable`, async () => {
      stubFetch(async () => {
        throw new Error("ECONNREFUSED");
      });
      const res = await request(app).post(`/api${route}`).send({ query: "x" });

      expect(res.status).toBe(500);
      expect(res.body).toMatchObject({ success: false });
    });
  }

  it("POST /rumor-check/chatbot → 500 when the upstream returns non-JSON", async () => {
    stubFetch(async () => new Response("<html>oops</html>", { status: 200 }));
    const res = await request(app).post("/api/rumor-check/chatbot").send({ query: "x" });

    expect(res.status).toBe(500);
    expect(res.body).toMatchObject({ success: false });
  });
});
