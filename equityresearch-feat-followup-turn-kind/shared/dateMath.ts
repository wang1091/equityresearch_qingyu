/**
 * Provider-agnostic TS date math — the single home for "today" anchoring, ISO validation,
 * and date arithmetic. Extracted from shared/earnings/calendarIntent.ts so any flow needing
 * deterministic dates (earnings calendar, MARKET_DATA return windows, …) computes them in TS
 * rather than trusting an LLM to do date arithmetic. See docs/LLM_TS_DUPLICATION_INVENTORY.md
 * and the LLM/TS boundary principle: dates are always TS.
 *
 * All arithmetic anchors at UTC noon so date-only math is immune to DST / timezone drift.
 */

/**
 * Current date (YYYY-MM-DD) in US Eastern time — the industry-standard basis for US-equity
 * flows (NYSE/Nasdaq operate on ET; pre/post-market timing is ET). Use this as the anchor for
 * all relative-date resolution so "today / N-ago / window" line up with US market data.
 */
export function easternToday(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

/** True for a well-formed YYYY-MM-DD calendar date. */
export function validateIsoDate(d: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return false;
  return !Number.isNaN(Date.parse(`${d}T12:00:00Z`));
}

/** A YYYY-MM-DD date as a UTC-noon-anchored Date (valid ISO, else today). */
function anchor(iso: string): Date {
  return new Date(`${validateIsoDate(iso) ? iso : easternToday()}T12:00:00Z`);
}

/** A Date → YYYY-MM-DD. */
export function isoOf(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function addDays(iso: string, n: number): string {
  const d = anchor(iso);
  d.setUTCDate(d.getUTCDate() + n);
  return isoOf(d);
}

export function addMonths(iso: string, n: number): string {
  const d = anchor(iso);
  d.setUTCMonth(d.getUTCMonth() + n);
  return isoOf(d);
}

export function addYears(iso: string, n: number): string {
  const d = anchor(iso);
  d.setUTCFullYear(d.getUTCFullYear() + n);
  return isoOf(d);
}
