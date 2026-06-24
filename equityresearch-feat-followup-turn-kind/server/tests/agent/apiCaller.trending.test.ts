// Characterization net for the S1 TRENDING line: now fetches via the strategy
// plan registry (planRegistry.ts → routes/trending.fetchTrending) instead of a
// loopback self-HTTP call. apiCaller's category="all" maps to the no-category
// (plain trending) variant.
import { describe, it, expect, vi, afterEach } from "vitest";

const fetchTrending = vi.fn();
vi.mock("../../trending/service", () => ({
  fetchTrending: (...args: unknown[]) => fetchTrending(...args),
}));

import { callApis } from "../../agent/apiCaller";

afterEach(() => {
  vi.unstubAllGlobals();
  fetchTrending.mockReset();
});

function stubNoLoopback() {
  const fetchMock = vi.fn(async () => {
    throw new Error("must not loopback to /api/trending-stocks");
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("callApis TRENDING via plan registry", () => {
  it("maps category 'all' (default) → fetchTrending(lang, '') — no loopback", async () => {
    const data = { success: true, trending: [{ ticker: "NVDA" }] };
    fetchTrending.mockResolvedValueOnce(data);
    const fetchMock = stubNoLoopback();

    const apiData = await callApis(["TRENDING"], { TRENDING: { lang: "en" } });

    expect(fetchTrending).toHaveBeenCalledWith("en", "");
    expect(apiData.TRENDING).toEqual(data);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("passes a specific category through", async () => {
    fetchTrending.mockResolvedValueOnce({ success: true });
    stubNoLoopback();

    await callApis(["TRENDING"], { TRENDING: { category: "tech", language: "zh" } });

    expect(fetchTrending).toHaveBeenCalledWith("zh", "tech");
  });
});
