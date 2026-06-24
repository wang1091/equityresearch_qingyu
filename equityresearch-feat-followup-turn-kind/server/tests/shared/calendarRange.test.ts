// Offline net for resolveCalendarRangeFromQuery (shared/earnings/calendarIntent.ts).
// Pure date math — pin "today" so week/month/quarter resolution is deterministic.
import { describe, it, expect } from "vitest";
import {
  resolveCalendarRangeFromQuery,
  resolveCalendarDateFromQuery,
} from "../../../shared/earnings";

const TODAY = "2026-06-20"; // Saturday

describe("resolveCalendarRangeFromQuery — quarter", () => {
  it("Q4 (no year) → current-year Oct–Dec", () => {
    expect(resolveCalendarRangeFromQuery("which companies report in Q4", TODAY)).toEqual({
      grain: "quarter",
      start: "2026-10-01",
      end: "2026-12-31",
      months: ["2026-10", "2026-11", "2026-12"],
      label: "2026 Q4",
    });
  });

  it("第四季度 → Oct–Dec", () => {
    const r = resolveCalendarRangeFromQuery("第四季度哪些公司发财报", TODAY)!;
    expect(r.grain).toBe("quarter");
    expect([r.start, r.end]).toEqual(["2026-10-01", "2026-12-31"]);
  });

  it("Q1 2025 → explicit year", () => {
    const r = resolveCalendarRangeFromQuery("earnings calendar Q1 2025", TODAY)!;
    expect([r.start, r.end, r.label]).toEqual(["2025-01-01", "2025-03-31", "2025 Q1"]);
  });
});

describe("resolveCalendarRangeFromQuery — month", () => {
  it("this month → June 2026", () => {
    const r = resolveCalendarRangeFromQuery("who reports this month", TODAY)!;
    expect([r.start, r.end, r.grain]).toEqual(["2026-06-01", "2026-06-30", "month"]);
  });

  it("next month → July 2026", () => {
    const r = resolveCalendarRangeFromQuery("earnings next month", TODAY)!;
    expect([r.start, r.end]).toEqual(["2026-07-01", "2026-07-31"]);
  });

  it("六月 → June (current year)", () => {
    const r = resolveCalendarRangeFromQuery("六月有哪些公司发财报", TODAY)!;
    expect([r.start, r.end]).toEqual(["2026-06-01", "2026-06-30"]);
  });

  it("十二月 → December (two-char zh month)", () => {
    const r = resolveCalendarRangeFromQuery("十二月财报日历", TODAY)!;
    expect([r.start, r.end]).toEqual(["2026-12-01", "2026-12-31"]);
  });

  it("explicit 2027-03 → March 2027", () => {
    const r = resolveCalendarRangeFromQuery("earnings calendar 2027-03", TODAY)!;
    expect([r.start, r.end]).toEqual(["2027-03-01", "2027-03-31"]);
  });
});

describe("resolveCalendarRangeFromQuery — week", () => {
  it("next week → following Mon–Sun", () => {
    // 2026-06-20 is Sat; its week's Monday is 2026-06-15, next week 06-22..06-28
    const r = resolveCalendarRangeFromQuery("who reports next week", TODAY)!;
    expect([r.start, r.end, r.grain]).toEqual(["2026-06-22", "2026-06-28", "week"]);
  });

  it("下周 → next Mon–Sun", () => {
    const r = resolveCalendarRangeFromQuery("下周哪些公司发财报", TODAY)!;
    expect([r.start, r.end]).toEqual(["2026-06-22", "2026-06-28"]);
  });

  it("this week → current Mon–Sun", () => {
    const r = resolveCalendarRangeFromQuery("earnings this week", TODAY)!;
    expect([r.start, r.end]).toEqual(["2026-06-15", "2026-06-21"]);
  });
});

describe("resolveCalendarRangeFromQuery — no range phrase", () => {
  it("returns null for a single-day / no-range query", () => {
    expect(resolveCalendarRangeFromQuery("who reports tomorrow", TODAY)).toBeNull();
    expect(resolveCalendarRangeFromQuery("today's earnings", TODAY)).toBeNull();
  });
});

describe("named weekday → single day, NOT a week range (bug: 下周一)", () => {
  it("下周一 resolves to next Monday and is NOT a range", () => {
    expect(resolveCalendarRangeFromQuery("下周一谁发财报", TODAY)).toBeNull();
    expect(resolveCalendarDateFromQuery("下周一谁发财报", TODAY)).toBe("2026-06-22");
  });

  it("下周 (no weekday) is still the week range", () => {
    expect(resolveCalendarRangeFromQuery("下周谁发财报", TODAY)?.grain).toBe("week");
  });

  it("本周三 → this week's Wednesday", () => {
    expect(resolveCalendarRangeFromQuery("本周三财报", TODAY)).toBeNull();
    expect(resolveCalendarDateFromQuery("本周三财报", TODAY)).toBe("2026-06-17");
  });

  it("next Monday / next Friday (English)", () => {
    expect(resolveCalendarDateFromQuery("who reports next monday", TODAY)).toBe("2026-06-22");
    expect(resolveCalendarDateFromQuery("下周五财报", TODAY)).toBe("2026-06-26");
  });
});
