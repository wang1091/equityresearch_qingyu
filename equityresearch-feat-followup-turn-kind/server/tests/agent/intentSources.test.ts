import { describe, expect, it } from "vitest";
import {
  VALID_DATA_SOURCES,
  isValidDataSource,
  filterValidDataSources,
} from "../../agent/intentSources";

describe("intent data-source whitelist", () => {
  // The A+B increment: a STOCK_PICKER classification must survive validation.
  // Before this lands, the classifier could emit STOCK_PICKER but routes.ts
  // would filter it out (not in the whitelist) and silently fall back to GENERAL.
  it("recognizes STOCK_PICKER as a valid data source", () => {
    expect(isValidDataSource("STOCK_PICKER")).toBe(true);
    expect(VALID_DATA_SOURCES).toContain("STOCK_PICKER");
  });

  it("still recognizes the pre-existing sources", () => {
    for (const src of ["EARNINGS", "VALUATION", "TRENDING", "GENERAL", "NEWS"]) {
      expect(isValidDataSource(src)).toBe(true);
    }
  });

  it("rejects unknown / malformed sources", () => {
    expect(isValidDataSource("STOCK_PICKER_COMPARISON")).toBe(false); // not a source — it's a UI sub-label
    expect(isValidDataSource("nonsense")).toBe(false);
    expect(isValidDataSource(undefined)).toBe(false);
    expect(isValidDataSource(123)).toBe(false);
  });

  it("filterValidDataSources keeps STOCK_PICKER and drops junk, preserving order", () => {
    expect(
      filterValidDataSources(["STOCK_PICKER", "bogus", "EARNINGS"]),
    ).toEqual(["STOCK_PICKER", "EARNINGS"]);
    expect(filterValidDataSources("not-an-array")).toEqual([]);
  });
});
