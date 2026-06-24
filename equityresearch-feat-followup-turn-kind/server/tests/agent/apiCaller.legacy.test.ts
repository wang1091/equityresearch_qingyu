// Per-source contract net for the NON-plan-registry (legacy switch) sources:
// EARNINGS / PERFORMANCE / STOCK_PICKER delegate to module services; VALUATION /
// NEWS go through fetchJsonWithFallback; COMPETITIVE bare-fetches its provider.
// Each is exercised through callApis with the relevant seam mocked (lang "en" so
// the in-apiCaller localizers short-circuit). No network, no LLM.
import { describe, it, expect, vi, afterEach } from "vitest";

const fetchEarningsData = vi.fn();
vi.mock("../../earnings/service", async (orig) => ({
  ...(await orig<typeof import("../../earnings/service")>()),
  fetchEarningsData: (...a: unknown[]) => fetchEarningsData(...a),
}));

const fetchPerformanceData = vi.fn();
vi.mock("../../performance/service", async (orig) => ({
  ...(await orig<typeof import("../../performance/service")>()),
  fetchPerformanceData: (...a: unknown[]) => fetchPerformanceData(...a),
}));

const fetchStockPickerCard = vi.fn();
vi.mock("../../stockPicker/service", async (orig) => ({
  ...(await orig<typeof import("../../stockPicker/service")>()),
  fetchStockPickerCard: (...a: unknown[]) => fetchStockPickerCard(...a),
}));

const fetchJsonWithFallback = vi.fn();
vi.mock("../../upstreamFetch", async (orig) => ({
  ...(await orig<typeof import("../../upstreamFetch")>()),
  fetchJsonWithFallback: (...a: unknown[]) => fetchJsonWithFallback(...a),
}));

import { callApis } from "../../agent/apiCaller";

afterEach(() => {
  vi.unstubAllGlobals();
  fetchEarningsData.mockReset();
  fetchPerformanceData.mockReset();
  fetchStockPickerCard.mockReset();
  fetchJsonWithFallback.mockReset();
});

describe("callApis legacy sources — delegate to module services", () => {
  it("EARNINGS → fetchEarningsData", async () => {
    fetchEarningsData.mockResolvedValueOnce({ topic: "summary", ok: true });
    const apiData = await callApis(["EARNINGS"], { EARNINGS: { ticker: "AAPL" } });
    expect(fetchEarningsData).toHaveBeenCalledTimes(1);
    expect(apiData.EARNINGS).toEqual({ topic: "summary", ok: true });
  });

  it("PERFORMANCE → fetchPerformanceData", async () => {
    fetchPerformanceData.mockResolvedValueOnce({ cagr: "12%" });
    const apiData = await callApis(["PERFORMANCE"], { PERFORMANCE: { ticker: "AAPL" } });
    expect(fetchPerformanceData).toHaveBeenCalledTimes(1);
    expect(apiData.PERFORMANCE).toEqual({ cagr: "12%" });
  });

  it("STOCK_PICKER → fetchStockPickerCard", async () => {
    fetchStockPickerCard.mockResolvedValueOnce({ picks: [] });
    const apiData = await callApis(["STOCK_PICKER"], { STOCK_PICKER: { query: "best AI stocks" } });
    expect(fetchStockPickerCard).toHaveBeenCalledTimes(1);
    expect(apiData.STOCK_PICKER).toEqual({ picks: [] });
  });
});

describe("callApis legacy sources — via fetchJsonWithFallback", () => {
  it("VALUATION → fetchJsonWithFallback (localize no-op for en)", async () => {
    fetchJsonWithFallback.mockResolvedValueOnce({ upside_percentage: "8" });
    const apiData = await callApis(["VALUATION"], { VALUATION: { ticker: "AAPL", lang: "en" } });
    expect(fetchJsonWithFallback).toHaveBeenCalledTimes(1);
    expect(apiData.VALUATION).toEqual({ upside_percentage: "8" });
  });

  it("NEWS → fetchJsonWithFallback", async () => {
    fetchJsonWithFallback.mockResolvedValueOnce({ items: [{ title: "t" }] });
    const apiData = await callApis(["NEWS"], { NEWS: { query: "AAPL news", lang: "en" } });
    expect(fetchJsonWithFallback).toHaveBeenCalledTimes(1);
    expect(apiData.NEWS).toEqual({ items: [{ title: "t" }] });
  });

  it("VALUATION failure → failed source ({error})", async () => {
    fetchJsonWithFallback.mockRejectedValueOnce(new Error("valuation upstream down"));
    const apiData = await callApis(["VALUATION"], { VALUATION: { ticker: "AAPL", lang: "en" } });
    expect(apiData.VALUATION).toEqual({ error: "valuation upstream down" });
  });
});

describe("callApis legacy sources — COMPETITIVE (bare fetch + domain failover)", () => {
  it("returns the provider's data on success (no failover)", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ success: true, forces: { rivalry: "high" } }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const apiData = await callApis(
      ["COMPETITIVE"],
      { COMPETITIVE: { ticker: "AAPL", companyName: "Apple", lang: "en" } },
    );

    expect(fetchMock).toHaveBeenCalledTimes(1); // success → no failover to the other provider
    expect(apiData.COMPETITIVE).toEqual({ success: true, forces: { rivalry: "high" } });
  });

  it("fails over to the other provider on UPSTREAM_LLM_FAILED", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ success: false, code: "UPSTREAM_LLM_FAILED" }), { status: 200 }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ success: true, forces: { rivalry: "low" } }), { status: 200 }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const apiData = await callApis(
      ["COMPETITIVE"],
      { COMPETITIVE: { ticker: "AAPL", lang: "en" } },
    );

    expect(fetchMock).toHaveBeenCalledTimes(2); // primary LLM-failed → retried the fallback provider
    expect(apiData.COMPETITIVE).toEqual({ success: true, forces: { rivalry: "low" } });
  });
});
