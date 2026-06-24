/**
 * Wire contract for the EARNINGS response (server/earnings/service.ts —
 * SmartNews earnings endpoints). The response is a topic-discriminated union;
 * single source of truth for formatter + simplifier. Pragmatic coverage of the
 * shapes simplifyEarnings handles (ask / calendar / next / multi_quarter_ask /
 * summary-qa-transcript card).
 */

/**
 * Known `source` values across earnings responses. SmartNews may emit others
 * (e.g. `curated_insider`); the `(string & {})` arm keeps the type open while
 * still documenting + autocompleting the known set. NOTE: `curated_calendar` is
 * normalized to `calendar` in server/earnings/service.ts before it reaches the
 * formatter, so it is intentionally absent here.
 */
export type EarningsSource =
  | "calendar"
  | "web"
  | "transcript"
  | "nasdaq"
  | "smartnews"
  | "error"
  | (string & {});

export interface EarningsCalendarRow {
  symbol: string;
  name?: string;
  time?: string;
  fiscalQuarterEnding?: string;
  eps?: string | number | null;
  epsForecast?: string | number | null;
}

export interface EarningsCitation {
  id: number;
  quote: string;
}

/** Free-form earnings Q&A (topic "ask"; transcript_qa normalizes to this). */
export interface EarningsAskResponse {
  success?: boolean;
  topic: "ask";
  ticker: string;
  year: number | null;
  quarter: number | null;
  hasAnswer: boolean;
  source?: EarningsSource;
  answer: string;
  question?: string;
  citations?: EarningsCitation[];
  references?: string[];
  thinking?: string;
  docType?: string;
  highlightPhrases?: string[];
  rag_context?: unknown;
}

/**
 * Calendar topic covers two market-wide shapes:
 *   - single day  → { date, calendar: { asOf, rows } }
 *   - range (week/month/quarter) → { range, days, totalCompanies, ... }
 * A single-TICKER calendar ("TSLA earnings calendar", "X 下次财报") is rendered as
 * an EarningsAskResponse (source:"calendar") — see buildTickerCalendarAnswer.
 */
export interface EarningsCalendarResponse {
  topic: "calendar";
  source?: EarningsSource;
  // single-day market calendar
  date?: string;
  calendar?: { asOf?: string; rows: EarningsCalendarRow[] };
  // range calendar — companies grouped by date, capped
  range?: { grain: "week" | "month" | "quarter"; start: string; end: string; label: string };
  days?: Array<{ date: string; companies: Array<{ symbol: string; time?: string }> }>;
  totalCompanies?: number;
  totalDays?: number;
  shownCompanies?: number;
}

export interface EarningsQuarterAnswer {
  quarter: number | string;
  year: number;
  answer: string | null;
  hasAnswer: boolean;
}

export interface EarningsMultiQuarterResponse {
  topic: "multi_quarter_ask";
  ticker: string;
  year?: number;
  question?: string;
  quarters: EarningsQuarterAnswer[];
}

export interface EarningsSection {
  heading: string;
  bullets?: string[];
}

/** Card topics (summary / qa / transcript): sections list under `data`. */
export interface EarningsCardResponse {
  topic: string;
  ticker: string;
  year?: number | null;
  quarter?: number | null;
  data: EarningsSection[];
}

export type EarningsResponse =
  | EarningsAskResponse
  | EarningsCalendarResponse
  | EarningsMultiQuarterResponse
  | EarningsCardResponse;
