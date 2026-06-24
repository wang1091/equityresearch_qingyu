// L2 behavior net for the Yahoo/FMP quote proxies: /stock-detail/:ticker,
// /stock-price/:ticker, /similar-stocks/:ticker, /analyst-ratings/:ticker and
// /analyst-ratings/:ticker/detail. These are pure upstream proxies (no app
// deps beyond console+fetch). Stubs global fetch to pin: a full stock-detail
// success mapping, and the uniform "upstream throws -> 500" contract for all
// five routes (also asserting each hits its expected upstream host).
//
// Run green against the inline code before extracting quotes/* out of routes.ts;
// must stay green after the move.
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
  vi.unstubAllEnvs();
  __resetHttpClientStateForTests(); // reset FMP per-host circuit breaker between tests
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

describe("Yahoo/FMP quote proxies (L2)", () => {
  it("GET /stock-detail/:ticker maps the FMP quote/profile/metrics response", async () => {
    vi.stubEnv("FMP_API_KEY", "test-key"); // fmpFetch's fetchFn appends the key
    const fetchMock = stubFetch(async (url: string) => {
      const u = String(url);
      if (u.includes("/quote?"))
        return jsonRes([{ symbol: "AAPL", name: "Apple Inc.", price: 200.5, marketCap: 3.1e12, pe: 30, eps: 6.5, exchange: "NASDAQ", currency: "USD", volume: 1000, dayHigh: 201, dayLow: 199, yearHigh: 260, yearLow: 160 }]);
      if (u.includes("/profile?"))
        return jsonRes([{ companyName: "Apple Inc.", beta: 1.2, lastDiv: 1, currency: "USD" }]);
      if (u.includes("/key-metrics-ttm?"))
        return jsonRes([{ pbRatioTTM: 45 }]);
      return jsonRes([]);
    });
    const res = await request(app).get("/api/stock-detail/AAPL");

    expect(res.status).toBe(200);
    // routed through the hardened FMP client, NOT raw Yahoo
    expect(fetchMock.mock.calls.some((c) => String(c[0]).includes("financialmodelingprep.com"))).toBe(true);
    expect(res.body).toMatchObject({
      success: true,
      ticker: "AAPL",
      name: "Apple Inc.",
      currentPrice: { price: 200.5 },
      fundamentals: { pe: 30, eps: 6.5, beta: 1.2, priceToBook: 45 },
    });
  });

  it("GET /stock-detail/:ticker maps an FMP failure to 500", async () => {
    vi.stubEnv("FMP_API_KEY", "test-key");
    const fetchMock = stubFetch(async () => {
      throw new Error("upstream down");
    });
    const res = await request(app).get("/api/stock-detail/AAPL");

    expect(res.status).toBe(500);
    expect(res.body).toMatchObject({ success: false });
    expect(fetchMock.mock.calls.some((c) => String(c[0]).includes("financialmodelingprep.com"))).toBe(true);
  });

  const errorCases: Array<{ path: string; host: string }> = [
    { path: "/stock-price/AAPL", host: "query2.finance.yahoo.com" },
    { path: "/similar-stocks/AAPL", host: "query2.finance.yahoo.com" },
    { path: "/analyst-ratings/AAPL/detail", host: "query2.finance.yahoo.com" },
    { path: "/analyst-ratings/AAPL", host: "query2.finance.yahoo.com" },
  ];

  for (const { path, host } of errorCases) {
    it(`GET ${path} hits ${host} and maps an upstream failure to 500`, async () => {
      const fetchMock = stubFetch(async () => {
        throw new Error("upstream down");
      });
      const res = await request(app).get(`/api${path}`);

      expect(res.status).toBe(500);
      expect(res.body).toMatchObject({ success: false });
      expect(fetchMock.mock.calls.some((c) => String(c[0]).includes(host))).toBe(true);
    });
  }
});
