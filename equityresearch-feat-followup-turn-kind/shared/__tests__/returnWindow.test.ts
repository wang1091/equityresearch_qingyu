import { describe, it, expect } from "vitest";
import { resolveReturnWindow } from "../returnWindow";

const TODAY = "2026-06-23"; // fixed anchor → deterministic assertions

const from = (q: string) => resolveReturnWindow(q, TODAY)?.fromDate;

describe("resolveReturnWindow — confident windows → TS-computed from/to", () => {
  it("absolute: since <year> / from <year>", () => {
    expect(resolveReturnWindow("NVDA total return since 2020", TODAY)).toEqual({
      queryType: "return_calc", fromDate: "2020-01-01", toDate: TODAY,
    });
    expect(from("AAPL return from 2019")).toBe("2019-01-01");
  });

  it("absolute: since <iso>", () => {
    expect(from("performance since 2021-03-15")).toBe("2021-03-15");
  });

  it("YTD", () => {
    expect(from("NVDA YTD return")).toBe("2026-01-01");
    expect(from("年初至今涨了多少")).toBe("2026-01-01");
  });

  it("relative months (the 6-month case computed off today)", () => {
    expect(from("AAPL 6-month return")).toBe("2025-12-23");
    expect(from("past 3 months performance")).toBe("2026-03-23");
    expect(from("过去6个月")).toBe("2025-12-23");
  });

  it("relative years", () => {
    expect(from("MSFT 5-year return")).toBe("2021-06-23");
    expect(from("last 1 year")).toBe("2025-06-23");
    expect(from("过去3年")).toBe("2023-06-23");
    expect(from("1Y")).toBe("2025-06-23");
  });

  it("relative quarters / weeks", () => {
    expect(from("trailing 2 quarters")).toBe("2025-12-23"); // -6 months
    expect(from("last 4 weeks")).toBe("2026-05-26"); // -28 days
  });

  it("toDate is always the anchor (today)", () => {
    expect(resolveReturnWindow("NVDA 1 year return", TODAY)?.toDate).toBe(TODAY);
  });
});

describe("resolveReturnWindow — no confident window → null (LLM dates kept)", () => {
  it("non-windowed market queries", () => {
    expect(resolveReturnWindow("what is NVDA price", TODAY)).toBeNull();
    expect(resolveReturnWindow("NVDA market cap", TODAY)).toBeNull();
    expect(resolveReturnWindow("AAPL P/E ratio", TODAY)).toBeNull();
  });

  it("does NOT mistake a money amount for a month window ($10m)", () => {
    expect(resolveReturnWindow("what would $10m invested in AMZN be worth", TODAY)).toBeNull();
  });
});
