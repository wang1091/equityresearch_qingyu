// L2 behavior net for /earnings/calendar — the one earnings endpoint NOT covered
// by the L1 validation tier (it's a GET with no body guard). The other four
// earnings endpoints (summarize-earnings, earnings-fallback, earnings/ask,
// earnings/query) already have their 400-before-I/O contract pinned by
// routes.smoke.test.ts; combined with tsc (imports resolve) and the L1 route
// table golden, that nets the verbatim extraction of those handlers.
//
// Written and run green against the inline code before extracting earnings/* out
// of routes.ts; must stay green after the move.
import { describe, it, expect, beforeAll, beforeEach, vi } from "vitest";
import express, { type Express } from "express";
import request from "supertest";
import { registerRoutes } from "../../routes";
import { fetchNasdaqEarningsCalendar } from "../../earnings/nasdaqCalendar";

// Keep validateIsoDate real (pure); stub only the upstream calendar fetch.
vi.mock("../../earnings/nasdaqCalendar", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../earnings/nasdaqCalendar")>();
  return { ...actual, fetchNasdaqEarningsCalendar: vi.fn() };
});

const calMock = vi.mocked(fetchNasdaqEarningsCalendar);
let app: Express;

beforeAll(async () => {
  app = express();
  app.use(express.json());
  await registerRoutes(app);
});

beforeEach(() => {
  calMock.mockReset();
});

describe("GET /earnings/calendar (L2)", () => {
  it("rejects a malformed date with 400 and does not hit the upstream", async () => {
    const res = await request(app).get("/api/earnings/calendar").query({ date: "not-a-date" });
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ success: false });
    expect(calMock).not.toHaveBeenCalled();
  });

  it("passes a valid date through to the Nasdaq calendar and wraps the result", async () => {
    calMock.mockResolvedValue([{ ticker: "AAPL" }] as any);
    const res = await request(app).get("/api/earnings/calendar").query({ date: "2026-01-15" });

    expect(res.status).toBe(200);
    expect(calMock).toHaveBeenCalledWith("2026-01-15");
    expect(res.body).toMatchObject({
      success: true,
      topic: "calendar",
      date: "2026-01-15",
      source: "nasdaq",
      calendar: [{ ticker: "AAPL" }],
    });
  });

  it("defaults to today's date when none is given", async () => {
    calMock.mockResolvedValue([] as any);
    const today = new Date().toISOString().split("T")[0];
    const res = await request(app).get("/api/earnings/calendar");

    expect(res.status).toBe(200);
    expect(calMock).toHaveBeenCalledWith(today);
    expect(res.body.date).toBe(today);
  });

  it("maps an upstream failure to 502", async () => {
    calMock.mockRejectedValue(new Error("nasdaq down"));
    const res = await request(app).get("/api/earnings/calendar").query({ date: "2026-01-15" });

    expect(res.status).toBe(502);
    expect(res.body).toMatchObject({ success: false, error: "nasdaq down" });
  });
});
