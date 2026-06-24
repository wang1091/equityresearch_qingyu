// Characterization net for the S1 FDA + RUMOR lines: both now fetch via the
// strategy plan registry (planRegistry.ts) instead of a loopback self-HTTP call.
// FDA → routes/fda.fetchFdaUpstream; RUMOR → routes/rumor.proxyRumorChatbot
// (+ localizeRumorData, a no-op for lang!=="zh"). Boundaries are mocked.
import { describe, it, expect, vi, afterEach } from "vitest";

const fetchFdaUpstream = vi.fn();
vi.mock("../../fda/service", () => ({
  fetchFdaUpstream: (...args: unknown[]) => fetchFdaUpstream(...args),
}));

const proxyRumorChatbot = vi.fn();
vi.mock("../../rumor/service", () => ({
  proxyRumorChatbot: (...args: unknown[]) => proxyRumorChatbot(...args),
}));

import { callApis } from "../../agent/apiCaller";

afterEach(() => {
  vi.unstubAllGlobals();
  fetchFdaUpstream.mockReset();
  proxyRumorChatbot.mockReset();
});

function stubNoLoopback() {
  const fetchMock = vi.fn(async () => {
    throw new Error("must not loopback to a local /api route");
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("callApis FDA via plan registry", () => {
  it("calls fetchFdaUpstream with the ticker path — no loopback", async () => {
    const data = { companies: [{ ticker: "PFE" }] };
    fetchFdaUpstream.mockResolvedValueOnce(data);
    const fetchMock = stubNoLoopback();

    const apiData = await callApis(["FDA"], { FDA: { ticker: "PFE" } });

    expect(fetchFdaUpstream).toHaveBeenCalledWith("/api/companies/PFE");
    expect(apiData.FDA).toEqual(data);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("uses the company-search path when only a company name is given", async () => {
    fetchFdaUpstream.mockResolvedValueOnce({ companies: [] });
    stubNoLoopback();

    await callApis(["FDA"], { FDA: { companyName: "Moderna" } });

    const path = fetchFdaUpstream.mock.calls[0][0] as string;
    expect(path.startsWith("/api/companies/search?company=")).toBe(true);
  });
});

describe("callApis RUMOR via plan registry", () => {
  it("calls proxyRumorChatbot with the normalized body and returns its data (lang en → no localize)", async () => {
    const data = { success: true, report: { markdown: "..." } };
    proxyRumorChatbot.mockResolvedValueOnce(data);
    const fetchMock = stubNoLoopback();

    const apiData = await callApis(["RUMOR"], { RUMOR: { query: "is X true?", lang: "en" } });

    expect(proxyRumorChatbot).toHaveBeenCalledWith({
      query: "is X true?",
      language: "en",
      include_raw: true,
    });
    expect(apiData.RUMOR).toEqual(data);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("a logical {success:false} upstream → failed source ({error})", async () => {
    proxyRumorChatbot.mockResolvedValueOnce({ success: false, error: "nope" });
    stubNoLoopback();

    const apiData = await callApis(["RUMOR"], { RUMOR: { query: "x", lang: "en" } });

    // callSingleApi throws → callApis records the source as failed with {error}.
    expect(apiData.RUMOR).toEqual({ error: "nope" });
  });
});
