// Orchestration net for callApis (the source-agnostic behavior): parallel
// dispatch + allSettled resilience, multi-ticker fan-out merge, missing-params
// skip, onToolCall lifecycle, and the GENERAL synthetic source. Driven through
// two mocked services (getMarketData + fetchFdaUpstream) — no network, no LLM.
import { describe, it, expect, vi, afterEach } from "vitest";

const getMarketData = vi.fn();
const fmpFetch = vi.fn();
vi.mock("../../marketData/marketDataService", () => ({
  getMarketData: (...a: unknown[]) => getMarketData(...a),
  fmpFetch: (...a: unknown[]) => fmpFetch(...a),
}));

const fetchFdaUpstream = vi.fn();
vi.mock("../../fda/service", () => ({
  fetchFdaUpstream: (...a: unknown[]) => fetchFdaUpstream(...a),
}));

import { callApis } from "../../agent/apiCaller";

afterEach(() => {
  vi.unstubAllGlobals();
  getMarketData.mockReset();
  fetchFdaUpstream.mockReset();
});

function stubNoNetwork() {
  vi.stubGlobal("fetch", vi.fn(async () => {
    throw new Error("callApis must not touch the network in these tests");
  }));
}

describe("callApis orchestration", () => {
  it("one source failing does not abort the others (allSettled)", async () => {
    getMarketData.mockResolvedValueOnce({ success: true, x: 1 });
    fetchFdaUpstream.mockRejectedValueOnce(new Error("fda down"));
    stubNoNetwork();

    const apiData = await callApis(
      ["MARKET_DATA", "FDA"],
      { MARKET_DATA: { tickers: ["A"] }, FDA: { ticker: "PFE" } },
    );

    expect(apiData.MARKET_DATA).toEqual({ success: true, x: 1 });
    expect(apiData.FDA).toEqual({ error: "fda down" }); // failed source → {error}
  });

  it("fans out array params per ticker and merges successes into an array", async () => {
    getMarketData
      .mockResolvedValueOnce({ success: true, t: "A" })
      .mockResolvedValueOnce({ success: true, t: "B" });
    stubNoNetwork();

    const apiData = await callApis(
      ["MARKET_DATA"],
      { MARKET_DATA: [{ tickers: ["A"] }, { tickers: ["B"] }] },
    );

    expect(getMarketData).toHaveBeenCalledTimes(2);
    expect(apiData.MARKET_DATA).toEqual([{ success: true, t: "A" }, { success: true, t: "B" }]);
  });

  it("skips a source with no params (no call, no entry)", async () => {
    stubNoNetwork();
    const apiData = await callApis(["MARKET_DATA"], {});
    expect(getMarketData).not.toHaveBeenCalled();
    expect(apiData.MARKET_DATA).toBeUndefined();
  });

  it("fires onToolCall start -> success on a successful source", async () => {
    getMarketData.mockResolvedValueOnce({ success: true });
    stubNoNetwork();
    const events: string[] = [];
    await callApis(
      ["MARKET_DATA"],
      { MARKET_DATA: { tickers: ["A"] } },
      (i) => events.push(i.status),
    );
    expect(events).toEqual(["start", "success"]);
  });

  it("fires onToolCall start -> error on a failing source", async () => {
    getMarketData.mockRejectedValueOnce(new Error("boom"));
    stubNoNetwork();
    const events: { status: string; error?: string }[] = [];
    await callApis(
      ["MARKET_DATA"],
      { MARKET_DATA: { tickers: ["A"] } },
      (i) => events.push({ status: i.status, error: i.error }),
    );
    expect(events.map((e) => e.status)).toEqual(["start", "error"]);
    expect(events[1].error).toBe("boom");
  });

  it("GENERAL returns synthetic data without any fetch", async () => {
    stubNoNetwork();
    const apiData = await callApis(["GENERAL"], { GENERAL: { query: "what is P/E" } });
    expect(apiData.GENERAL).toEqual({ type: "general", query: "what is P/E" });
  });
});
