// Offline net for coerceMarketEarningsCalendar (server/earnings/routing.ts).
// Guards bug 003: the coerce step must NOT collapse to single-intent EARNINGS
// (dropping co-intents + discarding the classifier's scoped EARNINGS.question)
// when the query carries other intents. Sole-intent behavior must stay intact.
import { describe, it, expect } from "vitest";
import { coerceMarketEarningsCalendar } from "../../earnings/routing";

describe("coerceMarketEarningsCalendar — multi-intent guard (bug 003)", () => {
  it("keeps co-intents and the scoped EARNINGS question when EARNINGS is not the only source", () => {
    const cls: Record<string, any> = {
      required_data: ["EARNINGS", "VALUATION"],
      primary_focus: "EARNINGS",
      tickers: ["AAPL", "MSFT"],
      need_api: true,
      api_params: {
        EARNINGS: { ticker: "AAPL", topic: "transcript_qa", question: "AAPL latest earnings" },
        VALUATION: [
          { ticker: "AAPL", query: "AAPL vs MSFT valuation" },
          { ticker: "MSFT", query: "AAPL vs MSFT valuation" },
        ],
      },
    };

    coerceMarketEarningsCalendar(cls, "AAPL 财报怎么样，跟 MSFT 估值对比");

    // co-intent survives — was previously overwritten to ["EARNINGS"]
    expect(cls.required_data).toContain("EARNINGS");
    expect(cls.required_data).toContain("VALUATION");
    expect(cls.api_params.VALUATION).toBeDefined();
    // scoped earnings question is NOT clobbered with the full multi-intent message
    expect(cls.api_params.EARNINGS.question).toBe("AAPL latest earnings");
    expect(cls.api_params.EARNINGS.question).not.toContain("估值");
  });
});

describe("coerceMarketEarningsCalendar — sole-intent path unchanged", () => {
  it("still collapses a pure multi-ticker earnings comparison to one transcript_qa", () => {
    const cls: Record<string, any> = {
      required_data: ["EARNINGS"],
      primary_focus: "EARNINGS",
      tickers: ["NVDA", "AMD"],
      need_api: true,
      api_params: { EARNINGS: { topic: "transcript_qa", question: "compare nvidia and amd earnings" } },
    };

    coerceMarketEarningsCalendar(cls, "compare nvidia and amd earnings");

    expect(cls.required_data).toEqual(["EARNINGS"]);
    expect(cls.api_params.EARNINGS.topic).toBe("transcript_qa");
    expect([...cls.tickers].sort()).toEqual(["AMD", "NVDA"]);
  });

  it("still shapes a sole single-ticker earnings query", () => {
    const cls: Record<string, any> = {
      required_data: ["EARNINGS"],
      primary_focus: "EARNINGS",
      tickers: ["TSLA"],
      need_api: true,
      api_params: { EARNINGS: { ticker: "TSLA", topic: "transcript_qa", question: "Tesla Q3 earnings overview" } },
    };

    coerceMarketEarningsCalendar(cls, "特斯拉Q3财报");

    expect(cls.required_data).toEqual(["EARNINGS"]);
    expect(cls.primary_focus).toBe("EARNINGS");
    expect(cls.api_params.EARNINGS.ticker).toBe("TSLA");
    expect(cls.api_params.EARNINGS.topic).toBe("transcript_qa");
  });
});

describe("coerceMarketEarningsCalendar — single-ticker calendar (tier 1)", () => {
  it("routes 'X earnings calendar' (one ticker) to topic=calendar WITH the ticker", () => {
    const cls: Record<string, any> = {
      required_data: ["EARNINGS"],
      primary_focus: "EARNINGS",
      tickers: ["TSLA"],
      need_api: true,
      api_params: { EARNINGS: { topic: "calendar", ticker: "TSLA" } },
    };

    coerceMarketEarningsCalendar(cls, "tesla earnings calendar");

    expect(cls.required_data).toEqual(["EARNINGS"]);
    expect(cls.api_params.EARNINGS).toEqual({ topic: "calendar", ticker: "TSLA" });
    expect(cls.tickers).toEqual(["TSLA"]);
  });

  it("rescues a misclassified single-ticker calendar (GENERAL) when a ticker is present", () => {
    const cls: Record<string, any> = {
      required_data: ["GENERAL"],
      primary_focus: "GENERAL",
      tickers: ["AAPL"],
      need_api: false,
      api_params: {},
    };

    coerceMarketEarningsCalendar(cls, "AAPL 财报日历");

    expect(cls.primary_focus).toBe("EARNINGS");
    expect(cls.need_api).toBe(true);
    expect(cls.api_params.EARNINGS).toEqual({ topic: "calendar", ticker: "AAPL" });
  });

  it("does NOT collapse a single-ticker calendar when another data source is present", () => {
    const cls: Record<string, any> = {
      required_data: ["EARNINGS", "NEWS"],
      primary_focus: "EARNINGS",
      tickers: ["TSLA"],
      need_api: true,
      api_params: {
        EARNINGS: { topic: "calendar", ticker: "TSLA" },
        NEWS: { query: "tesla news", language: "en" },
      },
    };

    coerceMarketEarningsCalendar(cls, "tesla earnings calendar and latest news");

    expect(cls.required_data).toContain("NEWS");
    expect(cls.api_params.NEWS).toBeDefined();
  });

  it("routes 'X 下次财报' (next) to calendar+ticker+direction=upcoming (absorbs old `next`)", () => {
    const cls: Record<string, any> = {
      required_data: ["EARNINGS"],
      primary_focus: "EARNINGS",
      tickers: ["TSLA"],
      need_api: true,
      api_params: { EARNINGS: { topic: "calendar", ticker: "TSLA", direction: "upcoming" } },
    };

    coerceMarketEarningsCalendar(cls, "特斯拉下次财报是什么时候");

    expect(cls.api_params.EARNINGS).toEqual({ topic: "calendar", ticker: "TSLA", direction: "upcoming" });
  });

  it("derives direction=past from text when a detector fires ('X last earnings date')", () => {
    const cls: Record<string, any> = {
      required_data: ["GENERAL"],
      primary_focus: "GENERAL",
      tickers: ["AAPL"],
      need_api: false,
      api_params: {},
    };

    coerceMarketEarningsCalendar(cls, "AAPL last earnings date");

    expect(cls.api_params.EARNINGS).toEqual({ topic: "calendar", ticker: "AAPL", direction: "past" });
  });

  it("fires on classifier-chosen calendar even when TS detectors miss the phrasing", () => {
    const cls: Record<string, any> = {
      required_data: ["EARNINGS"],
      primary_focus: "EARNINGS",
      tickers: ["AAPL"],
      need_api: true,
      // detectors miss "上次财报是什么时候" (word order); the classifier caught it.
      api_params: { EARNINGS: { topic: "calendar", direction: "past" } },
    };

    coerceMarketEarningsCalendar(cls, "AAPL 上次财报是什么时候");

    expect(cls.api_params.EARNINGS).toEqual({ topic: "calendar", ticker: "AAPL", direction: "past" });
  });

  it("full schedule ('X earnings calendar') carries no direction", () => {
    const cls: Record<string, any> = {
      required_data: ["EARNINGS"],
      primary_focus: "EARNINGS",
      tickers: ["NVDA"],
      need_api: true,
      api_params: { EARNINGS: { topic: "calendar", ticker: "NVDA" } },
    };

    coerceMarketEarningsCalendar(cls, "nvidia earnings calendar");

    expect(cls.api_params.EARNINGS).toEqual({ topic: "calendar", ticker: "NVDA" });
  });

  it("leaves market-wide calendar (no ticker) untouched by the single-ticker branch", () => {
    const cls: Record<string, any> = {
      required_data: ["EARNINGS"],
      primary_focus: "EARNINGS",
      tickers: [],
      need_api: true,
      api_params: { EARNINGS: { topic: "calendar", date: "2026-06-25" } },
    };

    coerceMarketEarningsCalendar(cls, "who reports earnings tomorrow");

    expect(cls.tickers).toEqual([]);
    expect(cls.api_params.EARNINGS.topic).toBe("calendar");
    expect(cls.api_params.EARNINGS.ticker).toBeUndefined();
  });
});

// Market-wide calendar — DATE wiring (tier 2). Guards that coerce threads the
// shared date resolvers into api_params: a RANGE phrase ("next week", "Q4",
// "this month") becomes a grain+start+end window (server fans out over months),
// while a single-day phrase ("today/tomorrow", "今天/明天") becomes a single
// `date` and carries NO grain. The exact date math itself is pinned offline in
// calendarRange.test.ts; here we only assert the coerce WIRING + shape.
//
// Explicit-period cases (Q1 2025, 2027-03) are run-date-independent and asserted
// in full. Relative cases (today/next week) depend on easternToday() — which
// coerce calls internally and we cannot pin — so they assert shape + ISO format,
// not concrete dates.
const ISO = /^\d{4}-\d{2}-\d{2}$/;
const marketCal = (query: string) => {
  const cls: Record<string, any> = {
    required_data: ["EARNINGS"],
    primary_focus: "EARNINGS",
    tickers: [],
    need_api: true,
    api_params: { EARNINGS: { topic: "calendar" } },
  };
  coerceMarketEarningsCalendar(cls, query);
  return cls.api_params.EARNINGS as Record<string, any>;
};

describe("coerceMarketEarningsCalendar — market-wide date wiring (tier 2)", () => {
  it("explicit quarter ('Q1 2025') → run-date-independent grain=quarter window", () => {
    expect(marketCal("which companies report in Q1 2025")).toEqual({
      topic: "calendar",
      grain: "quarter",
      start: "2025-01-01",
      end: "2025-03-31",
      months: ["2025-01", "2025-02", "2025-03"],
      label: "2025 Q1",
    });
  });

  it("explicit month ('2027-03') → run-date-independent grain=month window", () => {
    expect(marketCal("earnings calendar 2027-03")).toEqual({
      topic: "calendar",
      grain: "month",
      start: "2027-03-01",
      end: "2027-03-31",
      months: ["2027-03"],
      label: "2027-03",
    });
  });

  it("relative range ('next week') → grain=week window, ISO start/end, NO date field", () => {
    const e = marketCal("who reports earnings next week");
    expect(e.topic).toBe("calendar");
    expect(e.grain).toBe("week");
    expect(e.label).toBe("next week");
    expect(e.start).toMatch(ISO);
    expect(e.end).toMatch(ISO);
    expect(e.date).toBeUndefined();
  });

  it("single day ('today') → single `date`, NO grain/start (not a range)", () => {
    const e = marketCal("who reports earnings today");
    expect(e.topic).toBe("calendar");
    expect(e.date).toMatch(ISO);
    expect(e.grain).toBeUndefined();
    expect(e.start).toBeUndefined();
  });

  it("single day zh ('明天') → single `date`, NO grain (tomorrow must not collapse to a range)", () => {
    const e = marketCal("明天谁发财报");
    expect(e.topic).toBe("calendar");
    expect(e.date).toMatch(ISO);
    expect(e.grain).toBeUndefined();
  });

  it("does NOT collapse a market-wide range when another data source is present", () => {
    const cls: Record<string, any> = {
      required_data: ["EARNINGS", "NEWS"],
      primary_focus: "EARNINGS",
      tickers: [],
      need_api: true,
      api_params: {
        EARNINGS: { topic: "calendar" },
        NEWS: { query: "market news", language: "en" },
      },
    };

    coerceMarketEarningsCalendar(cls, "who reports earnings this week and what's the market news");

    expect(cls.required_data).toContain("NEWS");
    expect(cls.api_params.NEWS).toBeDefined();
  });
});
