import { describe, it, expect } from "vitest";
import { easternToday, validateIsoDate, isoOf, addDays, addMonths, addYears } from "../dateMath";

describe("validateIsoDate", () => {
  it("accepts well-formed YYYY-MM-DD and rejects the rest", () => {
    expect(validateIsoDate("2026-06-23")).toBe(true);
    expect(validateIsoDate("2026-13-01")).toBe(false); // month 13
    expect(validateIsoDate("2026-6-3")).toBe(false); // not zero-padded
    expect(validateIsoDate("since 2020")).toBe(false);
    expect(validateIsoDate("")).toBe(false);
  });
});

describe("easternToday", () => {
  it("returns a valid YYYY-MM-DD", () => {
    expect(validateIsoDate(easternToday())).toBe(true);
  });
});

describe("date arithmetic (UTC-noon anchored, DST-safe)", () => {
  it("addMonths handles negative relative windows (the 6-month case)", () => {
    expect(addMonths("2026-06-23", -6)).toBe("2025-12-23");
    expect(addMonths("2026-06-23", -3)).toBe("2026-03-23");
    expect(addMonths("2026-01-15", -1)).toBe("2025-12-15"); // year boundary
  });

  it("addYears handles multi-year lookbacks", () => {
    expect(addYears("2026-06-23", -5)).toBe("2021-06-23");
    expect(addYears("2026-06-23", -1)).toBe("2025-06-23");
  });

  it("addDays crosses month/year boundaries", () => {
    expect(addDays("2026-06-23", 7)).toBe("2026-06-30");
    expect(addDays("2026-12-30", 5)).toBe("2027-01-04");
    expect(addDays("2026-06-23", -1)).toBe("2026-06-22");
  });

  it("isoOf strips a Date to YYYY-MM-DD", () => {
    expect(isoOf(new Date("2026-06-23T12:00:00Z"))).toBe("2026-06-23");
  });

  it("invalid anchor falls back to today (no NaN dates)", () => {
    expect(validateIsoDate(addMonths("garbage", -1))).toBe(true);
  });
});
