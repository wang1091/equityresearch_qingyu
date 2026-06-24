/**
 * Shared detection + date resolution for Nasdaq earnings calendar flows
 * (used by server classify + client preflight so behavior stays aligned).
 */
// Core date math now lives in shared/dateMath.ts (provider-agnostic). Re-exported here so
// existing `@shared/earnings` importers of easternToday/validateIsoDate keep working.
import { easternToday, validateIsoDate } from "../dateMath";
export { easternToday, validateIsoDate };

/** Strip invisible chars / odd spaces so intent regexes stay reliable across clients. */
export function normalizeQueryTextForCalendarIntent(query: string): string {
  return String(query ?? "")
    .replace(/\u200b|\u200c|\u200d|\u2060|\ufeff/g, "")
    .replace(/[\u2018\u2019\u201b]/g, "'")
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}

/** Internal: echoed user text so apiCaller can calendar-route if context.userMessage is missing */
export const EARNINGS_CALENDAR_USER_QUERY_HINT_KEY = "__calendarUserQuery";

/** True when the query names a specific weekday (周一 / 下周三 / next Monday …),
 *  so the range resolver knows NOT to treat "下周" as the whole next week. */
export function mentionsWeekday(query: string): boolean {
  const s = normalizeQueryTextForCalendarIntent(query).toLowerCase();
  return (
    /(?:周|星期|礼拜)\s*[一二三四五六日天]/.test(s) ||
    /\b(next|this|last|上|下|本|这|這)?\s*(monday|tuesday|wednesday|thursday|friday|saturday|sunday|mon|tue|tues|wed|thur|thurs|fri|sat|sun)\b/.test(s)
  );
}

/** Parse a named weekday into { weekday 1=Mon..7=Sun, offsetWeeks }. */
function parseRelativeWeekday(s: string): { weekday: number; offsetWeeks: number } | null {
  const zhMap: Record<string, number> = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 日: 7, 天: 7 };
  const zh = s.match(/(上|下|本|这|這)?\s*(?:周|星期|礼拜)\s*([一二三四五六日天])/);
  if (zh) {
    const w = zhMap[zh[2]];
    const offset = zh[1] === "下" ? 1 : zh[1] === "上" ? -1 : 0;
    return { weekday: w, offsetWeeks: offset };
  }
  const enMap: Record<string, number> = {
    monday: 1, mon: 1, tuesday: 2, tue: 2, tues: 2, wednesday: 3, wed: 3,
    thursday: 4, thur: 4, thurs: 4, friday: 5, fri: 5, saturday: 6, sat: 6, sunday: 7, sun: 7,
  };
  const en = s.match(
    /\b(next|this|last)?\s*(monday|tuesday|wednesday|thursday|friday|saturday|sunday|mon|tue|tues|wed|thur|thurs|fri|sat|sun)\b/,
  );
  if (en) {
    const w = enMap[en[2]];
    const offset = en[1] === "next" ? 1 : en[1] === "last" ? -1 : 0;
    return { weekday: w, offsetWeeks: offset };
  }
  return null;
}

export function resolveCalendarDateFromQuery(
  query: string,
  defaultIso: string,
): string {
  const q = normalizeQueryTextForCalendarIntent(query)
    .replace(/\/+\s*$/g, "")
    .trim();
  const iso = q.match(/\b(20\d{2}-\d{2}-\d{2})\b/);
  if (iso && validateIsoDate(iso[1])) return iso[1];

  const base = validateIsoDate(defaultIso)
    ? defaultIso
    : new Date().toISOString().slice(0, 10);
  const d = new Date(`${base}T12:00:00Z`);

  if (/\b(tomorrow|next day)\b/i.test(q) || /明天|翌日/.test(q)) {
    d.setUTCDate(d.getUTCDate() + 1);
    return d.toISOString().slice(0, 10);
  }
  if (/\b(yesterday)\b/i.test(q) || /昨天/.test(q)) {
    d.setUTCDate(d.getUTCDate() - 1);
    return d.toISOString().slice(0, 10);
  }

  // Named weekday ("下周一" / "本周三" / "next Monday"): a SINGLE day, resolved
  // against the Monday of the current week + offset weeks.
  const wd = parseRelativeWeekday(q.toLowerCase());
  if (wd) {
    const mondayOffset = (d.getUTCDay() + 6) % 7; // days since Monday (Mon=0)
    d.setUTCDate(d.getUTCDate() - mondayOffset + wd.offsetWeeks * 7 + (wd.weekday - 1));
    return d.toISOString().slice(0, 10);
  }

  return base;
}

export interface CalendarRange {
  grain: "week" | "month" | "quarter";
  start: string; // YYYY-MM-DD inclusive
  end: string; // YYYY-MM-DD inclusive
  months: string[]; // YYYY-MM list spanning [start, end] (months to fetch)
  label: string; // human-readable, e.g. "2026 Q4", "next week"
}

const RANGE_MONTH_NAMES_EN = [
  "january", "february", "march", "april", "may", "june",
  "july", "august", "september", "october", "november", "december",
];
const RANGE_MONTH_NAMES_ZH: Record<string, number> = {
  一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6,
  七: 7, 八: 8, 九: 9, 十: 10, 十一: 11, 十二: 12,
};
const RANGE_CN_QUARTER: Record<string, number> = { 一: 1, 二: 2, 三: 3, 四: 4 };

function monthsBetween(startYM: string, endYM: string): string[] {
  const out: string[] = [];
  let [y, m] = startYM.split("-").map(Number);
  const [ey, em] = endYM.split("-").map(Number);
  while (y < ey || (y === ey && m <= em)) {
    out.push(`${y}-${String(m).padStart(2, "0")}`);
    m++;
    if (m > 12) {
      m = 1;
      y++;
    }
  }
  return out;
}

function monthRange(year: number, month: number): CalendarRange {
  const mm = String(month).padStart(2, "0");
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return {
    grain: "month",
    start: `${year}-${mm}-01`,
    end: `${year}-${mm}-${String(lastDay).padStart(2, "0")}`,
    months: [`${year}-${mm}`],
    label: `${year}-${mm}`,
  };
}

/**
 * Parse a calendar RANGE phrase (week / month / quarter) from the query into a
 * concrete date range. Pure TS date math — the LLM only signals "this is a
 * calendar query"; TS turns "下周 / next week / 六月 / June / 第四季度 / Q4 2026"
 * into start/end + the YYYY-MM months to fetch. Returns null when no range
 * phrase is present (caller falls back to the single-date path).
 * Mirrors resolveCalendarDateFromQuery's UTC handling.
 */
export function resolveCalendarRangeFromQuery(
  query: string,
  defaultIso: string,
): CalendarRange | null {
  const s = normalizeQueryTextForCalendarIntent(query)
    .toLowerCase()
    .replace(/\/+\s*$/g, "")
    .trim();
  const base = validateIsoDate(defaultIso) ? defaultIso : new Date().toISOString().slice(0, 10);
  const today = new Date(`${base}T12:00:00Z`);
  const curYear = today.getUTCFullYear();
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  const explicitYear = (s.match(/\b(20\d{2})\b/) || [])[1]
    ? Number((s.match(/\b(20\d{2})\b/) || [])[1])
    : undefined;

  // —— Quarter: Q4 / fourth quarter / 第四季度 / 四季度 ——
  let q: number | undefined;
  const qDigit = s.match(/\bq([1-4])\b/) || s.match(/\b([1-4])(?:st|nd|rd|th)?\s*quarter\b/);
  if (qDigit) {
    q = Number(qDigit[1]);
  } else {
    const ord = s.match(/\b(first|second|third|fourth)\s+quarter\b/);
    if (ord) {
      q = { first: 1, second: 2, third: 3, fourth: 4 }[ord[1] as "first"];
    } else {
      const cn = s.match(/第?\s*([一二三四1-4])\s*季度/);
      if (cn) q = RANGE_CN_QUARTER[cn[1]] ?? Number(cn[1]);
    }
  }
  if (q && q >= 1 && q <= 4) {
    const year = explicitYear ?? curYear;
    const startM = (q - 1) * 3 + 1;
    const endM = q * 3;
    const lastDay = new Date(Date.UTC(year, endM, 0)).getUTCDate();
    const start = `${year}-${String(startM).padStart(2, "0")}-01`;
    const end = `${year}-${String(endM).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;
    return { grain: "quarter", start, end, months: monthsBetween(start.slice(0, 7), end.slice(0, 7)), label: `${year} Q${q}` };
  }

  // —— Week: this/next week / 本周 / 下周 ——
  // A named weekday ("下周一", "next Monday") is a SINGLE day, not the week range —
  // let resolveCalendarDateFromQuery handle it.
  const namesWeekday = mentionsWeekday(s);
  const nextWeek = !namesWeekday && (/\bnext\s+week\b/.test(s) || /下周|下個星期|下个星期/.test(s));
  const thisWeek = !namesWeekday && (/\bthis\s+week\b/.test(s) || /本周|这周|這週|本星期|这个星期/.test(s));
  if (nextWeek || thisWeek) {
    const mondayOffset = (today.getUTCDay() + 6) % 7; // days since Monday (Mon=0)
    const monday = new Date(today);
    monday.setUTCDate(today.getUTCDate() - mondayOffset + (nextWeek ? 7 : 0));
    const sunday = new Date(monday);
    sunday.setUTCDate(monday.getUTCDate() + 6);
    const start = iso(monday);
    const end = iso(sunday);
    return { grain: "week", start, end, months: monthsBetween(start.slice(0, 7), end.slice(0, 7)), label: nextWeek ? "next week" : "this week" };
  }

  // —— Month: YYYY-MM / this/next month / month name / 六月 / 6月 ——
  const ymExplicit = s.match(/\b(20\d{2})-(0[1-9]|1[0-2])\b/);
  if (ymExplicit) return monthRange(Number(ymExplicit[1]), Number(ymExplicit[2]));
  if (/\bnext\s+month\b/.test(s) || /下个月|下個月|下月/.test(s)) {
    let y = curYear;
    let m = today.getUTCMonth() + 2;
    if (m > 12) {
      m = 1;
      y++;
    }
    return monthRange(y, m);
  }
  if (/\bthis\s+month\b/.test(s) || /本月|这个月|這個月|当月/.test(s)) {
    return monthRange(curYear, today.getUTCMonth() + 1);
  }
  for (let i = 0; i < 12; i++) {
    const name = RANGE_MONTH_NAMES_EN[i];
    if (new RegExp(`\\b${name}\\b|\\b${name.slice(0, 3)}\\b`).test(s)) {
      return monthRange(explicitYear ?? curYear, i + 1);
    }
  }
  const zhMonth = s.match(/(十[一二]|[一二三四五六七八九十]|\d{1,2})\s*月/);
  if (zhMonth) {
    const tok = zhMonth[1];
    const m = /^\d+$/.test(tok) ? Number(tok) : RANGE_MONTH_NAMES_ZH[tok];
    if (m && m >= 1 && m <= 12) return monthRange(explicitYear ?? curYear, m);
  }

  return null;
}

/** Broad market “who reports when” — includes singular “company”. */
export function looksLikeEarningsCalendarQuery(query: string): boolean {
  const s = normalizeQueryTextForCalendarIntent(query)
    .toLowerCase()
    .replace(/\/+\s*$/g, "")
    .trim();

  if (
    /\b(which|what)\s+compan(y|ies)\b/i.test(s) &&
    /\b(earning|earnings|earn|report|release|call)\b/i.test(s)
  ) {
    return true;
  }
  if (/\b(which|what)\s+(companies|stocks|tickers|firms)\b/i.test(s) && /\bearn/.test(s)) {
    return true;
  }
  if (/\b(who)\b.*\b(report|reports|reported|released|release)\b/i.test(s) && /\bearn/.test(s)) {
    return true;
  }
  if (
    /\b(companies|stocks|tickers)\b.*\b(report|reporting|release|released)\b.*\bearn/.test(s)
  ) {
    return true;
  }
  if (
    /\b(released?|release|reporting)\b.*\bearn/i.test(s) &&
    /\b(today|tomorrow|tonight|this week)\b/.test(s)
  ) {
    return true;
  }
  if (/\bearn(ings)?\b.*\b(today|tomorrow|tonight|this week)\b/i.test(s)) {
    return true;
  }
  if (/\b(reporting|releases?)\b.*\b(today|tomorrow)\b/.test(s) && /\bearn/.test(s)) {
    return true;
  }
  if (/\b(earnings|reports)\s+(calendar|schedule)\b/i.test(s)) return true;
  if (/\bearning\s+call\b/i.test(s) && /\b(today|tomorrow|released?|schedule)\b/i.test(s)) {
    return true;
  }
  if (/哪些公司.*财报|今天.*财报|财报.*今天|业绩.*今天|发布.*日程|财报.*日程/.test(s)) {
    return true;
  }
  // "谁发财报 / 下周谁发财报" — who reports, with a release verb to avoid matching
  // comparison questions like "谁的财报最好".
  if (/谁.{0,2}(发|公布|发布)财报/.test(s)) {
    return true;
  }
  return false;
}

/**
 * Per-ticker "when is the next earnings call for X?" — distinct from the
 * market-wide calendar (which returns every company on a given date).
 * Matches: "when does Apple release earnings", "when is AAPL's next earnings call",
 * "Apple next earnings date", "苹果什么时候发布财报", "苹果下次财报".
 */
export function looksLikeNextEarningsForTicker(query: string): boolean {
  const s = normalizeQueryTextForCalendarIntent(query)
    .toLowerCase()
    .replace(/\/+\s*$/g, "")
    .trim();

  // English: "when {does|is|will} ... {release|report|announce} ... earning(s)/earnings call"
  if (
    /\bwhen\b/.test(s) &&
    /\b(release|releases|releasing|report|reports|reporting|announce|announces|announcing|next)\b/.test(s) &&
    /\b(earning|earnings|earnings\s+call|earning\s+call)\b/.test(s)
  ) {
    return true;
  }
  // English: "next earnings (date|call|report)"
  if (/\bnext\s+earning(s)?\s*(date|call|report|release)?\b/.test(s)) {
    return true;
  }
  // English: "upcoming earnings"
  if (/\bupcoming\s+earning(s)?\b/.test(s)) return true;
  // Chinese: "什么时候 ... 财报", "下次财报", "下一季财报"
  if (/什么时候.*财报|下次.*财报|下一(次|季|期).*财报|何时.*财报/.test(s)) {
    return true;
  }
  return false;
}

/**
 * Free-form earnings-date / scheduling questions about a *specific* quarter
 * (past or upcoming). Distinct from `looksLikeNextEarningsForTicker` (which is
 * forward-looking only) and `looksLikeEarningsCalendarQuery` (market-wide).
 * Matches: "rivian q1 2025 earning date", "AAPL Q3 2024 earnings call date",
 * "what date was Tesla's Q2 2024 earnings call", "财报日期", "电话会日期".
 */
export function looksLikeEarningsDateQuery(query: string): boolean {
  const s = normalizeQueryTextForCalendarIntent(query)
    .toLowerCase()
    .replace(/\/+\s*$/g, "")
    .trim();

  // English: "...earning(s) [call] date" / "date of ... earnings [call]"
  if (
    /\bearning(s)?\s*(call\s*)?date\b/.test(s) ||
    /\bdate\s+of\s+(the\s+)?earning(s)?\s*(call)?\b/.test(s) ||
    /\bwhen\s+(was|is)\s+(the\s+)?(q[1-4]\s*\d{4}|\d{4}\s*q[1-4])?[^?]*\bearning(s)?\s*(call)?\b/.test(s)
  ) {
    return true;
  }
  // Chinese: 财报日期 / 财报时间 / 电话会日期 / 财报什么时候
  if (/财报\s*(日期|时间|什么时候|何时)|电话会\s*(日期|时间)/.test(s)) {
    return true;
  }
  return false;
}

/**
 * Single-ticker earnings calendar / schedule intent, e.g. "TSLA earnings
 * calendar", "AAPL earnings schedule", "NVDA earnings dates", "特斯拉财报日程".
 * Distinct from the market-wide `looksLikeEarningsCalendarQuery` ("who reports
 * today") — this is "show me COMPANY X's call schedule". Requires an earnings
 * word AND a calendar/schedule word; the ticker itself comes from the classifier
 * (TS regex deliberately does not extract tickers — that's the LLM's job, and it
 * also can't survive typos like "earnigns", which the prompt layer must handle).
 */
export function looksLikeEarningsCalendarForTicker(query: string): boolean {
  const s = normalizeQueryTextForCalendarIntent(query)
    .toLowerCase()
    .replace(/\/+\s*$/g, "")
    .trim();
  const hasEarnings = /\bearning(s)?\b|财报|业绩|电话会/.test(s);
  // Schedule words only (calendar/schedule/日历/日程) — deliberately NOT bare
  // "date(s)", so single-date questions ("X earnings call date") still fall to
  // the "ask" path rather than rendering the full schedule table.
  const hasCalendar = /\b(calendar|schedule)\b|日历|日程/.test(s);
  return hasEarnings && hasCalendar;
}

/**
 * Detect whether the user is asking for an *investment recommendation*
 * ("should I buy", "is X a good investment", "buy or sell"). The agent
 * reserves the multi-module Investment Brief template for these queries
 * only — every other question gets a plain-prose answer instead.
 */
export function looksLikeInvestmentDecisionQuery(query: string): boolean {
  const s = normalizeQueryTextForCalendarIntent(query)
    .toLowerCase()
    .replace(/\/+\s*$/g, "")
    .trim();

  // English: "should I buy / sell / hold X", "is X a buy/sell", "is X worth buying"
  if (
    /\b(should\s+i|do\s+i|would\s+you)\b.*\b(buy|sell|hold|invest|short|long)\b/.test(s) ||
    /\bis\s+\S+\s+(a\s+)?(buy|sell|good\s+(investment|stock|buy)|worth\s+(buying|investing))\b/.test(s) ||
    /\b(buy|sell|hold)\s+or\s+(buy|sell|hold)\b/.test(s) ||
    /\b(investment|trading)\s+(decision|recommendation|advice|thesis)\b/.test(s) ||
    /\b(price\s+target|undervalued|overvalued|fairly\s+valued)\b/.test(s) ||
    /\bis\s+it\s+(a\s+)?(good\s+time\s+to|safe\s+to|smart\s+to)\b/.test(s)
  ) {
    return true;
  }

  // Chinese: 能买吗/值得买吗/适合投资/买入/卖出/投资建议/估值高/估值低
  if (
    /(能买|可以买|该不该买|值得买|是否值得|适合投资|买入还是|该买还是|要不要买|要不要卖)/.test(s) ||
    /(投资建议|交易建议|投资决策)/.test(s) ||
    /(估值偏高|估值偏低|高估|低估|目标价)/.test(s)
  ) {
    return true;
  }

  return false;
}


/** Tomorrow (YYYY-MM-DD) in US Eastern time. */
export function easternTomorrow(): string {
  const d = new Date(`${easternToday()}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

/** Calendar "today" baseline in the user's local timezone (browser). */
export function localCalendarDefaultIso(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
