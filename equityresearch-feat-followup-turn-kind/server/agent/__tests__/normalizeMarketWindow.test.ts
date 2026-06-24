import { describe, it, expect } from "vitest";
import { normalizeClassifierResult } from "../classifier/normalize";
import { easternToday } from "../../../shared/dateMath";

const ctx = { query: "", dateString: easternToday() };

/** Build a raw LLM-style result routed to MARKET_DATA with the given params. */
function mdResult(query: string, marketParams: Record<string, unknown>) {
  return normalizeClassifierResult(
    {
      required_data: ["MARKET_DATA"],
      primary_focus: "MARKET_DATA",
      tickers: ["NVDA"],
      need_api: true,
      api_params: { MARKET_DATA: { tickers: ["NVDA"], ...marketParams } },
    },
    { ...ctx, query },
  );
}

describe("normalize — MARKET_DATA return windows are TS-computed, not trusted from the LLM", () => {
  it("overrides the LLM's dates with TS dates for an absolute window (since 2020)", () => {
    // LLM emitted WRONG dates — TS must overwrite them.
    const out = mdResult("NVDA total return since 2020", { queryType: "return_calc", fromDate: "1999-01-01", toDate: "2000-01-01" });
    expect(out.api_params.MARKET_DATA.fromDate).toBe("2020-01-01");
    expect(out.api_params.MARKET_DATA.toDate).toBe(easternToday());
  });

  it("fills dates + upgrades queryType when the LLM omitted them on a windowed query", () => {
    const out = mdResult("NVDA 6-month return", { queryType: "price" }); // LLM under-specified
    const md = out.api_params.MARKET_DATA;
    expect(md.queryType).toBe("return_calc"); // upgraded
    expect(md.fromDate).toBeDefined();
    expect(md.toDate).toBe(easternToday());
  });

  it("preserves a historical queryType the LLM chose (comparison), only fixing the dates", () => {
    const out = mdResult("compare NVDA and AMD since 2021", { queryType: "comparison", fromDate: "bogus" });
    const md = out.api_params.MARKET_DATA;
    expect(md.queryType).toBe("comparison"); // NOT downgraded to return_calc
    expect(md.fromDate).toBe("2021-01-01");
  });

  it("leaves params untouched when there is no window phrase", () => {
    const out = mdResult("NVDA market cap", { queryType: "market_cap" });
    const md = out.api_params.MARKET_DATA;
    expect(md.queryType).toBe("market_cap");
    expect(md.fromDate).toBeUndefined();
    expect(md.toDate).toBeUndefined();
  });
});

describe("normalize — PERFORMANCE reroute to EARNINGS transcript_qa (KPI / historical)", () => {
  function perfResult(query: string) {
    return normalizeClassifierResult(
      {
        required_data: ["PERFORMANCE"],
        primary_focus: "PERFORMANCE",
        tickers: ["COST"],
        need_api: true,
        api_params: { PERFORMANCE: { ticker: "COST" } },
      },
      { ...ctx, query },
    );
  }

  // Only TIME-modified fundamentals reroute in TS (the authority). KPI / qualitative routing is
  // the LLM's job (prompt rules), so it is NOT exercised here — a normalize unit test can't (and
  // must not) re-judge that semantic call.
  it("time-modified fundamentals → EARNINGS transcript_qa with the raw question, PERFORMANCE dropped", () => {
    const out = perfResult("Costco revenue over the last 3 years");
    expect(out.primary_focus).toBe("EARNINGS");
    expect(out.required_data).toContain("EARNINGS");
    expect(out.required_data).not.toContain("PERFORMANCE");
    expect(out.api_params.EARNINGS).toMatchObject({ topic: "transcript_qa", question: "Costco revenue over the last 3 years", ticker: "COST" });
    expect(out.api_params.PERFORMANCE).toBeUndefined();
  });

  it("named quarter (specific period) → EARNINGS transcript_qa", () => {
    const out = perfResult("Costco Q2 2023 revenue");
    expect(out.primary_focus).toBe("EARNINGS");
    expect(out.api_params.EARNINGS?.topic).toBe("transcript_qa");
  });

  it("operating-KPI is NOT rerouted by TS (LLM's job) — normalize leaves the LLM's route", () => {
    const out = perfResult("how many paid members does Costco have"); // no time modifier
    expect(out.primary_focus).toBe("PERFORMANCE"); // TS does not touch it; LLM would have routed EARNINGS upstream
  });

  it("latest-quarter fundamentals STAY PERFORMANCE (reverse-lock)", () => {
    const out = perfResult("Costco latest quarter revenue");
    expect(out.primary_focus).toBe("PERFORMANCE");
    expect(out.api_params.PERFORMANCE).toBeDefined();
    expect(out.required_data).not.toContain("EARNINGS");
  });

  it("bare fundamentals (no KPI, no period) STAY PERFORMANCE (reverse-lock)", () => {
    const out = perfResult("Costco gross margin");
    expect(out.primary_focus).toBe("PERFORMANCE");
    expect(out.api_params.PERFORMANCE).toBeDefined();
  });
});
