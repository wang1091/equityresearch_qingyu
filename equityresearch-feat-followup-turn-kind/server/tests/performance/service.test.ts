// Unit net for fetchPerformanceData's peer resolution.
//
// Regression guard for the bug where a comparison turn ("AMD vs INTC") carried
// tickers:["AMD","INTC"] but the service used only tickers[0] and auto-resolved
// peers — silently dropping the peers the user explicitly named. Explicit peers
// (tickers[1..]) must now win over both analysis peers and the find-peers
// fallback, while single-ticker turns keep auto-resolution.
import { describe, it, expect, afterEach, vi } from "vitest";

vi.mock("../../localApi", () => ({ getLocalApiBase: () => "http://local" }));

import { fetchPerformanceData } from "../../performance/service";

const jsonRes = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

/**
 * Stub global fetch, routing by URL. `analysisPeers` is what company-analysis
 * reports as auto-peers. Returns captured state: the tickers sent to get-metrics
 * and whether the find-peers fallback was hit.
 */
function stubUpstream(analysisPeers: string[]) {
  const captured: {
    metricsTickers: string[] | null;
    findPeersCalled: boolean;
    analysisUrl: string | null;
  } = { metricsTickers: null, findPeersCalled: false, analysisUrl: null };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: any) => {
      if (url.includes("company-analysis")) {
        captured.analysisUrl = url;
        return jsonRes({ peers: analysisPeers });
      }
      if (url.includes("find-peers")) {
        captured.findPeersCalled = true;
        return jsonRes({ peers: ["ZZZ"] });
      }
      if (url.includes("get-metrics")) {
        captured.metricsTickers = JSON.parse(init.body).tickers;
        return jsonRes({}); // empty metrics → peer-analysis step is skipped
      }
      return jsonRes({});
    }),
  );
  return captured;
}

afterEach(() => vi.unstubAllGlobals());

describe("fetchPerformanceData — peer resolution", () => {
  it("multi-ticker: explicit user peers win, are sent to get-metrics, and find-peers is NOT called", async () => {
    const cap = stubUpstream(["NVDA"]); // analysis offers NVDA as an auto-peer
    const data = await fetchPerformanceData({ tickers: ["AMD", "INTC"] });

    expect(cap.metricsTickers).toEqual(["AMD", "INTC"]); // INTC kept, NVDA ignored
    expect(cap.findPeersCalled).toBe(false);
    expect(cap.analysisUrl).toContain("peers=INTC"); // narrative uses the user's peers too
    expect(data.peers).toEqual(["INTC"]);
  });

  it("multi-ticker: dedupes and drops a peer equal to the primary", async () => {
    const cap = stubUpstream([]);
    await fetchPerformanceData({ tickers: ["AMD", "amd", "INTC", "INTC"] });

    expect(cap.metricsTickers).toEqual(["AMD", "INTC"]);
  });

  it("single-ticker: no explicit peers → auto-resolution from analysis is preserved", async () => {
    const cap = stubUpstream(["NVDA", "AVGO"]);
    const data = await fetchPerformanceData({ tickers: ["AMD"] });

    expect(cap.metricsTickers).toEqual(["AMD", "NVDA", "AVGO"]);
    expect(cap.analysisUrl).not.toContain("peers="); // single-ticker → no peers param, auto-detect
    expect(data.peers).toEqual(["NVDA", "AVGO"]);
  });

  it("single-ticker with no analysis peers → find-peers fallback still fires", async () => {
    const cap = stubUpstream([]);
    await fetchPerformanceData({ ticker: "AMD" });

    expect(cap.findPeersCalled).toBe(true);
  });
});
