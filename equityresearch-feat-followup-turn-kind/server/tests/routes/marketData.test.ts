// L2 behavior net for the internal market-data endpoint /market-data (FMP →
// Yahoo via the marketData service). L1 covers the 400 guard; this pins the
// happy path — market-data passes the normalized request to getMarketData
// (service mocked). The former /detect-market-data endpoint was removed (dead
// duplication of the LLM classifier — see docs/LLM_TS_DUPLICATION_INVENTORY.md).
import { describe, it, expect, beforeAll, vi } from "vitest";
import express, { type Express } from "express";
import request from "supertest";
import { registerRoutes } from "../../routes";
import { getMarketData } from "../../marketData/marketDataService";

vi.mock("../../marketData/marketDataService", () => ({ getMarketData: vi.fn() }));

let app: Express;

beforeAll(async () => {
  app = express();
  app.use(express.json());
  await registerRoutes(app);
});

describe("market-data endpoints (L2)", () => {
  it("POST /market-data normalizes tickers and returns the service result", async () => {
    vi.mocked(getMarketData).mockResolvedValue({ ok: true } as any);
    const res = await request(app).post("/api/market-data").send({ tickers: ["nvda", " aapl "] });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
    expect(vi.mocked(getMarketData).mock.calls[0][0].tickers).toEqual(["NVDA", "AAPL"]);
  });
});
