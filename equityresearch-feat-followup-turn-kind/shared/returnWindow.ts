/**
 * Deterministic TS resolution of a price-return WINDOW ("since 2020", "6-month", "past 3
 * years", "YTD", "trailing 2 quarters") into { fromDate, toDate } for MARKET_DATA. Dates are
 * computed in TS off an Eastern-today anchor — never trusted from the LLM (LLM/TS boundary:
 * dates are always TS; a 9B classifier doing "6 months ago" arithmetic is the fragile link).
 *
 * Returns null when no window phrase is confidently parsed — the caller then leaves the LLM's
 * own dates (TS acts only where it is confident, so it can't regress phrasings it doesn't yet
 * cover). Bare compact "6M"/"3M" is intentionally NOT parsed: "m" collides with money ("$10m
 * invested"); those fall back to the LLM.
 */
import { addDays, addMonths, addYears, easternToday, validateIsoDate } from "./dateMath";

export interface ReturnWindow {
  queryType: "return_calc";
  fromDate: string;
  toDate: string;
}

const NUM_WORDS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12,
  一: 1, 两: 2, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10,
};
/** A captured count token (digits / English word / Chinese numeral) → number, default 1. */
function count(tok: string | undefined): number {
  if (!tok) return 1;
  if (/^\d+$/.test(tok)) return parseInt(tok, 10);
  return NUM_WORDS[tok] ?? 1;
}
const N = String.raw`(\d+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|一|两|二|三|四|五|六|七|八|九|十)`;
const CN_PAST = String.raw`(?:过去|近|最近)`;

export function resolveReturnWindow(query: string, todayIso: string = easternToday()): ReturnWindow | null {
  const to = validateIsoDate(todayIso) ? todayIso : easternToday();
  const s = String(query ?? "").toLowerCase().trim();
  const win = (fromDate: string): ReturnWindow => ({ queryType: "return_calc", fromDate, toDate: to });

  // YTD
  if (/\b(?:ytd|year[\s-]?to[\s-]?date)\b/.test(s) || /年初至今|今年以来/.test(s)) {
    return win(`${to.slice(0, 4)}-01-01`);
  }
  // since / from <iso>
  const sinceIso = s.match(/\b(?:since|from)\s*(20\d{2}-\d{2}-\d{2})\b/);
  if (sinceIso && validateIsoDate(sinceIso[1])) return win(sinceIso[1]);
  // since / from <year>  (自 2020 / 从2020年)
  const sinceYear = s.match(/(?:since|from|自|自从|从)\s*(20\d{2})\b/) || s.match(/(20\d{2})\s*年(?:以来|至今)/);
  if (sinceYear) return win(`${sinceYear[1]}-01-01`);

  // relative windows: N years / months / quarters / weeks (English word/compact + Chinese)
  const yrs = s.match(new RegExp(`${N}\\s*-?\\s*(?:years?|yrs?|y)\\b`)) || s.match(new RegExp(`${CN_PAST}?\\s*${N}\\s*年`));
  if (yrs) return win(addYears(to, -count(yrs[1])));

  const mos = s.match(new RegExp(`${N}\\s*-?\\s*(?:months?|mos?|mo)\\b`)) || s.match(new RegExp(`${CN_PAST}?\\s*${N}\\s*(?:个月|月)`));
  if (mos) return win(addMonths(to, -count(mos[1])));

  const qtrs = s.match(new RegExp(`${N}\\s*-?\\s*(?:quarters?|q)\\b`)) || s.match(new RegExp(`${CN_PAST}?\\s*${N}\\s*季度`));
  if (qtrs) return win(addMonths(to, -3 * count(qtrs[1])));

  const wks = s.match(new RegExp(`${N}\\s*-?\\s*(?:weeks?|w)\\b`)) || s.match(new RegExp(`${CN_PAST}?\\s*${N}\\s*周`));
  if (wks) return win(addDays(to, -7 * count(wks[1])));

  return null; // no confident window → caller keeps the LLM's dates
}
