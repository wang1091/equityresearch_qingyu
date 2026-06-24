/**
 * Nasdaq public earnings calendar (no API key).
 * @see https://api.nasdaq.com/api/calendar/earnings?date=YYYY-MM-DD
 */

import { validateIsoDate } from "../../shared/earnings";

export {
  validateIsoDate,
  resolveCalendarDateFromQuery,
  looksLikeEarningsCalendarQuery,
  looksLikeNextEarningsForTicker,
} from "../../shared/earnings";

const NASDAQ_EARNINGS_CALENDAR =
  "https://api.nasdaq.com/api/calendar/earnings";

const BROWSER_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
  Accept: "application/json, text/plain, */*",
  "Accept-Language": "en-US,en;q=0.9",
};

export type NasdaqCalendarRow = Record<string, string>;

export interface NasdaqEarningsCalendarPayload {
  asOf: string;
  headers: Record<string, string>;
  rows: NasdaqCalendarRow[];
}

export async function fetchNasdaqEarningsCalendar(
  date: string,
): Promise<NasdaqEarningsCalendarPayload> {
  if (!validateIsoDate(date)) {
    throw new Error(`Invalid calendar date: ${date}`);
  }
  const url = `${NASDAQ_EARNINGS_CALENDAR}?date=${encodeURIComponent(date)}`;
  const res = await fetch(url, {
    headers: BROWSER_HEADERS,
    signal: AbortSignal.timeout(20000),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Nasdaq calendar HTTP ${res.status}: ${text.slice(0, 240)}`);
  }
  let json: { data?: NasdaqEarningsCalendarPayload };
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error("Nasdaq calendar response was not JSON");
  }
  const inner = json?.data;
  if (!inner || !Array.isArray(inner.rows)) {
    throw new Error("Nasdaq calendar: unexpected response shape");
  }
  return {
    asOf: typeof inner.asOf === "string" ? inner.asOf : date,
    headers: inner.headers && typeof inner.headers === "object" ? inner.headers : {},
    rows: inner.rows,
  };
}
