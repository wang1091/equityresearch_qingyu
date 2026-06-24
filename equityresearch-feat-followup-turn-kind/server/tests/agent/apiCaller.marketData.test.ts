// Characterization net for the first S1 line: MARKET_DATA now fetches via the
// strategy plan registry (planRegistry.ts → getMarketData) instead of a loopback
// self-HTTP call to /api/market-data. Pins: getMarketData is invoked with the
// normalized request, no fetch() loopback happens, and getMarketData's total
// (never-throws) result flows through unchanged for success AND failure.
import { describe, it, expect, vi, afterEach } from "vitest";

const getMarketData = vi.fn();
vi.mock("../../marketData/marketDataService", () => ({
  getMarketData: (...args: unknown[]) => getMarketData(...args),
}));

import { callApis } from "../../agent/apiCaller";

afterEach(() => {
  vi.unstubAllGlobals();
  getMarketData.mockReset();
});

describe("callApis MARKET_DATA via plan registry", () => {
  it("fetches through getMarketData with the normalized request — no loopback self-call", async () => {
    const result = { success: true, tickers: ["NVDA"], quotes: [{ ticker: "NVDA" }], provider: "fmp" };
    getMarketData.mockResolvedValueOnce(result);
    const fetchMock = vi.fn(async () => {
      throw new Error("MARKET_DATA must not loopback to /api/market-data");
    });
    vi.stubGlobal("fetch", fetchMock);

    const apiData = await callApis(["MARKET_DATA"], {
      MARKET_DATA: { tickers: ["nvda"], queryType: "comparison", question: "compare" },
    });

    expect(getMarketData).toHaveBeenCalledOnce();
    expect(getMarketData.mock.calls[0][0]).toMatchObject({
      tickers: ["NVDA"], // upper-cased + trimmed
      queryType: "comparison",
      question: "compare",
      lang: "en",
    });
    expect(apiData.MARKET_DATA).toEqual(result);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("passes getMarketData's failure object through (total fn → success path, data carries .error)", async () => {
    const failure = {
      success: false,
      error: "MARKET_DATA_UNAVAILABLE",
      reason: "No tickers provided",
      tickers: [],
    };
    getMarketData.mockResolvedValueOnce(failure);

    const apiData = await callApis(["MARKET_DATA"], { MARKET_DATA: {} });

    // getMarketData never throws, so apiData carries its failure shape verbatim;
    // generator filters it out later via the truthy `.error`.
    expect(apiData.MARKET_DATA).toEqual(failure);
  });
});
