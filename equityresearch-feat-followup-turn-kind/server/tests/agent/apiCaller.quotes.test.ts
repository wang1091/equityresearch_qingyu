// Characterization net for the S1 quotes trio: STOCK_PRICE / PEER_STOCKS / RATING
// now fetch via the strategy plan registry (planRegistry.ts → routes/quotes
// services) instead of loopback self-HTTP calls. RATING picks detail vs simplified
// from requiredData length, then localizes (no-op for lang!=="zh").
import { describe, it, expect, vi, afterEach } from "vitest";

const fetchStockPrice = vi.fn();
const fetchSimilarStocks = vi.fn();
const fetchAnalystRating = vi.fn();
vi.mock("../../quotes/service", () => ({
  fetchStockPrice: (...a: unknown[]) => fetchStockPrice(...a),
  fetchSimilarStocks: (...a: unknown[]) => fetchSimilarStocks(...a),
  fetchAnalystRating: (...a: unknown[]) => fetchAnalystRating(...a),
}));

import { callApis } from "../../agent/apiCaller";

afterEach(() => {
  vi.unstubAllGlobals();
  fetchStockPrice.mockReset();
  fetchSimilarStocks.mockReset();
  fetchAnalystRating.mockReset();
});

function stubNoLoopback() {
  const fetchMock = vi.fn(async () => {
    throw new Error("must not loopback to a local /api route");
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("callApis quotes trio via plan registry", () => {
  it("STOCK_PRICE → fetchStockPrice(ticker), no loopback", async () => {
    const data = { success: true, ticker: "NVDA", currentPrice: { price: 100 } };
    fetchStockPrice.mockResolvedValueOnce(data);
    const fetchMock = stubNoLoopback();

    const apiData = await callApis(["STOCK_PRICE"], { STOCK_PRICE: { ticker: "NVDA" } });

    expect(fetchStockPrice).toHaveBeenCalledWith("NVDA");
    expect(apiData.STOCK_PRICE).toEqual(data);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("PEER_STOCKS → fetchSimilarStocks(ticker)", async () => {
    const data = { success: true, similarStocks: [] };
    fetchSimilarStocks.mockResolvedValueOnce(data);
    stubNoLoopback();

    const apiData = await callApis(["PEER_STOCKS"], { PEER_STOCKS: { ticker: "AAPL" } });

    expect(fetchSimilarStocks).toHaveBeenCalledWith("AAPL");
    expect(apiData.PEER_STOCKS).toEqual(data);
  });

  it("RATING single-intent → detail card", async () => {
    fetchAnalystRating.mockResolvedValueOnce({ success: true, rating: "BUY" });
    stubNoLoopback();

    await callApis(["RATING"], { RATING: { ticker: "TSLA", requiredData: ["RATING"], lang: "en" } });

    expect(fetchAnalystRating).toHaveBeenCalledWith("TSLA", { detail: true });
  });

  it("RATING multi-intent → simplified shape", async () => {
    fetchAnalystRating.mockResolvedValueOnce({ success: true, rating: "HOLD" });
    stubNoLoopback();

    await callApis(["RATING"], {
      RATING: { ticker: "TSLA", requiredData: ["RATING", "NEWS"], lang: "en" },
    });

    expect(fetchAnalystRating).toHaveBeenCalledWith("TSLA", { detail: false });
  });
});
