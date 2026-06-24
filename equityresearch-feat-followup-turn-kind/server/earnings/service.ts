/**
 * Earnings data service — the agent pipeline's EARNINGS data source.
 *
 * Resolves an EARNINGS api_params object to a response payload, routing by topic:
 *   calendar  → SmartNews enriched single-date calendar (Nasdaq fallback reserved)
 *   next      → next scheduled call for a ticker
 *   ask       → smartnews /api/earnings/ask (date fast-path via DB calendar first)
 *   transcript_qa → smartnews ask directly (free-form / multi-company RAG)
 *   summary/qa/transcript → DB-backed structured cards, with smartnews ask fallback
 *   multi-quarter fan-out → parallel ask per quarter
 *
 * Extracted verbatim from apiCaller's `case "EARNINGS"` (switch `break` → `return`).
 * Throws on hard input errors so the caller surfaces success:false; otherwise it
 * always returns a renderable payload (honest error cards included).
 */
import { logger } from "../utils";
import { getLocalApiBase } from "../localApi";
import { getSmartnewsApiBase } from "../upstreamConfig";
import { fetchJsonWithFallback, UpstreamFallbackError } from "../upstreamFetch";
import {
  fetchNasdaqEarningsCalendar, // retained for the reserved calendar fallback (see calendar branch)
} from "./nasdaqCalendar";
import {
  looksLikeEarningsCalendarQuery,
  looksLikeEarningsDateQuery,
  resolveCalendarDateFromQuery,
  easternToday,
  EARNINGS_CALENDAR_USER_QUERY_HINT_KEY,
} from "../../shared/earnings";

const SMARTNEWS_FALLBACK_API_BASE = getSmartnewsApiBase();
const UPSTREAM_ERROR_BODY_LIMIT = 1000;

interface SmartnewsCalendarRow {
  ticker: string;
  companyName?: string;
  year: number | string;
  quarter: number | string;
  callDate: string;
  earningsTiming?: string | null;
  source?: string;
}

/**
 * Fetch the smartnews DB-backed earnings calendar for a single ticker.
 * Returns null if the request fails or the ticker has no calendar entries.
 */
async function fetchSmartnewsTickerCalendar(
  ticker: string,
  opts?: { upcoming?: boolean },
): Promise<SmartnewsCalendarRow[] | null> {
  if (!ticker) return null;
  // show_upcoming=true makes the endpoint return FUTURE scheduled calls (Ninjas
  // upcoming → FMP → DB), needed for "X 下次财报 / next earnings"; without it the
  // endpoint returns only historical (transcript-backed) rows.
  const upcomingParam = opts?.upcoming ? "&show_upcoming=true" : "";
  const url = `${SMARTNEWS_FALLBACK_API_BASE}/api/earnings-calendar?ticker=${encodeURIComponent(
    ticker.toUpperCase(),
  )}${upcomingParam}`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
    if (!res.ok) return null;
    const json = await res.json();
    if (!json || json.success === false) return null;
    return Array.isArray(json.data) ? (json.data as SmartnewsCalendarRow[]) : null;
  } catch {
    return null;
  }
}

/**
 * Fetch the SmartNews enriched single-date earnings calendar.
 *   GET /api/v2/earnings-calendar/date?date=YYYY-MM-DD
 *   → { success, date, data: [{ ticker, reportDate, fiscalDateEnding, estimate,
 *        timeOfTheDay, companyName, marketCap, year, quarter }] }
 * Mapped into the EarningsCalendarRow shape consumed by the calendar card +
 * simplifyEarnings. AV calendar carries estimates only (no actual EPS).
 */
async function fetchSmartnewsDateCalendar(
  date: string,
): Promise<{ asOf?: string; rows: Array<Record<string, unknown>> }> {
  const url = `${SMARTNEWS_FALLBACK_API_BASE}/api/v2/earnings-calendar/date?date=${encodeURIComponent(date)}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(25000) });
  if (!res.ok) {
    throw new Error(`SmartNews date calendar failed: ${res.status} ${res.statusText}`);
  }
  const json = await res.json();
  if (!json || json.success === false || !Array.isArray(json.data)) {
    throw new Error("SmartNews date calendar returned no usable data");
  }
  const rows = json.data.map((e: any) => {
    const t = typeof e?.timeOfTheDay === "string" ? e.timeOfTheDay : "";
    const time =
      t === "pre-market" ? "time-pre-market" : t === "post-market" ? "time-after-hours" : "time-not-supplied";
    return {
      symbol: String(e?.ticker || "").toUpperCase(),
      name: e?.companyName || "",
      time,
      fiscalQuarterEnding: e?.fiscalDateEnding || "",
      eps: null, // AV calendar has estimates only, no actuals
      epsForecast: e?.estimate ?? null,
      year: e?.year ?? null,
      quarter: e?.quarter ?? null,
      marketCap: e?.marketCap ?? null,
    };
  });
  return { asOf: date, rows };
}

/**
 * Fetch one month of the SmartNews earnings calendar (grouped by date).
 *   GET /api/v2/earnings-calendar/month?month=YYYY-MM
 *   → { success, month, data: { "YYYY-MM-DD": [{ ticker, timeOfTheDay, ... }] } }
 */
async function fetchSmartnewsMonthCalendar(month: string): Promise<Record<string, any[]>> {
  const url = `${SMARTNEWS_FALLBACK_API_BASE}/api/v2/earnings-calendar/month?month=${encodeURIComponent(month)}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(25000) });
  if (!res.ok) throw new Error(`SmartNews month calendar failed: ${res.status} ${res.statusText}`);
  const json = await res.json();
  if (!json || json.success === false || typeof json.data !== "object" || json.data === null) return {};
  return json.data as Record<string, any[]>;
}

/**
 * Range calendar (week / month / quarter): fan out over the range's months,
 * merge + filter entries to [start, end], group by date, and cap the total
 * companies shown (the range can span thousands). Returns a structured payload
 * rendered by formatRangeCalendarCard. AV month entries are tickers-only (no
 * company name) — that's the data the month endpoint exposes.
 */
async function buildRangeCalendarAnswer(
  params: any,
  logLabel: string,
  startTime: number,
): Promise<Record<string, any>> {
  const months: string[] = Array.isArray(params.months) ? params.months : [];
  const start = String(params.start);
  const end = String(params.end);
  const label = String(params.label || `${start}~${end}`);
  const grain = String(params.grain || "range");

  const monthData = await Promise.all(
    months.map((m) => fetchSmartnewsMonthCalendar(m).catch(() => ({} as Record<string, any[]>))),
  );
  const byDate = new Map<string, any[]>();
  for (const md of monthData) {
    for (const [date, entries] of Object.entries(md)) {
      if (date < start || date > end || !Array.isArray(entries)) continue;
      const list = byDate.get(date) || [];
      for (const e of entries) list.push(e);
      byDate.set(date, list);
    }
  }
  const dates = [...byDate.keys()].sort();
  const totalCompanies = dates.reduce((n, d) => n + (byDate.get(d)?.length || 0), 0);

  const CAP = 80;
  let shown = 0;
  const days: Array<{ date: string; companies: Array<{ symbol: string; time: string }> }> = [];
  for (const date of dates) {
    if (shown >= CAP) break;
    const entries = byDate.get(date) || [];
    const companies = entries.slice(0, CAP - shown).map((e: any) => ({
      symbol: String(e?.ticker || "").toUpperCase(),
      time: typeof e?.timeOfTheDay === "string" ? e.timeOfTheDay : "",
    }));
    shown += companies.length;
    days.push({ date, companies });
  }

  logger.info(
    `  ✓ ${logLabel} range calendar ${label} (${totalCompanies} cos / ${dates.length} days, ${Date.now() - startTime}ms)`,
  );
  return {
    success: true,
    topic: "calendar",
    source: "smartnews",
    range: { grain, start, end, label },
    days,
    totalCompanies,
    totalDays: dates.length,
    shownCompanies: shown,
  };
}

/**
 * Build a single-ticker earnings-call SCHEDULE answer from the SmartNews ticker
 * calendar DATA endpoint (`/api/earnings-calendar?ticker=`), rendered on our
 * side — i.e. WITHOUT relying on SmartNews's `curated_calendar` ask path.
 * Returns an ask-shaped payload (`source:"calendar"`) so the existing
 * formatAskCard renders the markdown table. (A dedicated schedule card is tier 2.)
 */
function buildTickerCalendarAnswer(
  ticker: string,
  rows: SmartnewsCalendarRow[] | null,
  isZh: boolean,
  logLabel: string,
  startTime: number,
  direction?: "upcoming" | "past",
): Record<string, any> {
  const todayIso = easternToday();
  const dateOf = (r: SmartnewsCalendarRow) => String(r.callDate || "").slice(0, 10);
  // direction filters + orders the schedule: upcoming = future calls ascending
  // (next first); past = held calls descending (most recent first); none = full
  // schedule descending. The window is computed against today (TS), not the LLM.
  let sorted: SmartnewsCalendarRow[];
  if (direction === "upcoming") {
    sorted = (rows || [])
      .filter((r) => dateOf(r) >= todayIso)
      .sort((a, b) => dateOf(a).localeCompare(dateOf(b)))
      .slice(0, 12);
  } else if (direction === "past") {
    sorted = (rows || [])
      .filter((r) => dateOf(r) < todayIso)
      .sort((a, b) => dateOf(b).localeCompare(dateOf(a)))
      .slice(0, 12);
  } else {
    sorted = (rows || [])
      .slice()
      .sort((a, b) => dateOf(b).localeCompare(dateOf(a)))
      .slice(0, 12);
  }
  if (sorted.length === 0) {
    logger.info(`  ✓ ${logLabel} ticker calendar ${ticker} → empty (${Date.now() - startTime}ms)`);
    return {
      topic: "ask",
      source: "calendar",
      hasAnswer: false,
      answer: isZh ? `未找到 ${ticker} 的财报日历。` : `No earnings calendar found for ${ticker}.`,
      ticker,
      references: [],
      citations: [],
    };
  }
  const company = sorted[0].companyName ? ` (${sorted[0].companyName})` : "";
  const fmtQ = (q: unknown) =>
    q == null || q === "" ? "—" : String(q).toUpperCase().startsWith("Q") ? String(q).toUpperCase() : `Q${q}`;
  const fmtDate = (d: unknown) => (d ? String(d).slice(0, 10) : isZh ? "待定" : "TBD");
  const fmtTiming = (t: unknown) => {
    const s = String(t || "").toLowerCase();
    if (s.includes("before")) return isZh ? "盘前" : "Before market";
    if (s.includes("after")) return isZh ? "盘后" : "After market";
    return "—";
  };
  const title =
    direction === "upcoming"
      ? isZh ? "即将到来的财报" : "Upcoming Earnings"
      : direction === "past"
        ? isZh ? "近期财报" : "Recent Earnings"
        : isZh ? "财报电话会日程" : "Earnings Call Calendar";
  const head = isZh
    ? `| 季度 | 年份 | 电话会日期 | 时段 |\n|---|---|---|---|`
    : `| Quarter | Year | Call Date | Timing |\n|---|---|---|---|`;
  const body = sorted
    .map((r) => `| ${fmtQ(r.quarter)} | ${r.year || "—"} | ${fmtDate(r.callDate)} | ${fmtTiming(r.earningsTiming)} |`)
    .join("\n");
  const tzNote = isZh ? "🇺🇸 日期为美东时间 (ET)" : "🇺🇸 Dates in US Eastern (ET)";
  const answer = `**${ticker}${company} — ${title}**\n\n${head}\n${body}\n\n${tzNote}`;
  logger.info(`  ✓ ${logLabel} ticker calendar ${ticker} (${sorted.length} rows, ${Date.now() - startTime}ms)`);
  return {
    topic: "ask",
    source: "calendar",
    hasAnswer: true,
    answer,
    ticker,
    references: sorted.map(
      (r) =>
        `${r.ticker} ${fmtQ(r.quarter)} ${r.year}: ${fmtDate(r.callDate)}${r.earningsTiming ? ` (${r.earningsTiming})` : ""}`,
    ),
    citations: [],
  };
}

/**
 * SmartNews `/api/earnings/ask` labels DB-calendar answers `curated_calendar`
 * (insider answers `curated_insider`). Collapse `curated_calendar` → `calendar`
 * so the formatter's source pill + downstream treat it as a calendar result.
 * Any other source value passes through unchanged.
 */
function normalizeEarningsSource(source: unknown): string | undefined {
  if (typeof source !== "string") return undefined;
  return source === "curated_calendar" ? "calendar" : source;
}

export interface EarningsCallContext {
  userMessage?: string;
}

/**
 * Compact an EARNINGS payload for the generator (composite/secondary-source path).
 * Mirrors the topic shapes fetchEarningsData returns.
 */
export function simplifyEarnings(data: any): Record<string, any> {
  if (data.topic === "calendar" && data.range && Array.isArray(data.days)) {
    return {
      topic: "calendar",
      range: data.range,
      totalCompanies: data.totalCompanies,
      totalDays: data.totalDays,
      days: data.days.slice(0, 31).map((d: any) => ({
        date: d.date,
        count: Array.isArray(d.companies) ? d.companies.length : 0,
        symbols: Array.isArray(d.companies) ? d.companies.slice(0, 15).map((c: any) => c.symbol) : [],
      })),
    };
  }
  if (data.topic === "calendar" && data.calendar?.rows) {
    return {
      topic: "calendar",
      date: data.date,
      source: data.source,
      asOf: data.calendar.asOf,
      rowCount: data.calendar.rows.length,
      companies: data.calendar.rows.slice(0, 100).map((r: Record<string, string>) => ({
        symbol: r.symbol,
        name: r.name,
        time: r.time,
        fiscalQuarterEnding: r.fiscalQuarterEnding,
        eps: r.eps,
        epsForecast: r.epsForecast,
      })),
    };
  }
  if (data.topic === "multi_quarter_ask") {
    return {
      topic: "multi_quarter_ask",
      ticker: data.ticker,
      year: data.year,
      question: data.question,
      quarters: Array.isArray(data.quarters)
        ? data.quarters.map((q: any) => ({
            quarter: q.quarter,
            year: q.year,
            answer: typeof q.answer === "string" ? q.answer.slice(0, 300) : null,
            hasAnswer: q.hasAnswer,
          }))
        : [],
    };
  }
  // topic:"ask" is the dominant earnings shape — the default transcript_qa path,
  // explicit date questions, and every summary/qa/transcript fallback all
  // normalize to it, carrying their content in a single `answer` string. Without
  // this branch the payload fell to the default return below, which reads
  // `data.data` (absent here) and dropped the entire answer. Single-intent ask
  // bypasses simplify (index.ts isSingleEarningsAnswer); this only fires for
  // composite queries — which still need the answer.
  if (data.topic === "ask") {
    return {
      topic: "ask",
      ticker: data.ticker,
      year: data.year,
      quarter: data.quarter,
      hasAnswer: data.hasAnswer,
      source: data.source,
      answer: typeof data.answer === "string" ? data.answer.slice(0, 3000) : "",
      references: Array.isArray(data.references) ? data.references.slice(0, 5) : [],
    };
  }
  return {
    ticker: data.ticker,
    year: data.year,
    quarter: data.quarter,
    topic: data.topic,
    sections: Array.isArray(data.data)
      ? data.data.slice(0, 3).map((s: any) => ({
          heading: s.heading,
          bullets: Array.isArray(s.bullets) ? s.bullets.slice(0, 3) : s.bullets,
        }))
      : data.data,
  };
}

/**
 * Resolve an EARNINGS api_params object to a response payload.
 * `params` is mutated/normalized locally; `logLabel` is used only for logging.
 */
export async function fetchEarningsData(
  params: any,
  context: EarningsCallContext | undefined,
  logLabel: string,
): Promise<any> {
  const startTime = Date.now();
  const localApiBase = getLocalApiBase();
  let data: any;
  let response: Response;

  if (params && typeof params === "object" && !Array.isArray(params)) {
    params = { ...params };
  }
  const hintFromParams =
    typeof (params as any)?.[EARNINGS_CALENDAR_USER_QUERY_HINT_KEY] === "string"
      ? String((params as any)[EARNINGS_CALENDAR_USER_QUERY_HINT_KEY]).trim()
      : "";
  if (params && typeof params === "object" && !Array.isArray(params)) {
    delete (params as any)[EARNINGS_CALENDAR_USER_QUERY_HINT_KEY];
  }
  const userQ =
    (typeof context?.userMessage === "string" ? context.userMessage.trim() : "") ||
    hintFromParams;
  if (typeof params?.topic === "string") {
    params.topic = params.topic.toLowerCase().trim();
  } else if (params && typeof params === "object") {
    delete params.topic;
  }

  console.log("📋 EARNINGS apiCaller params:", JSON.stringify(params));
  // 5-topic taxonomy: calendar (schedule/WHEN) absorbed the old next/ask.
  const validTopics = ["summary", "qa", "transcript", "transcript_qa", "calendar"];
  // Default → "transcript_qa": all free-form CONTENT questions go through the
  // transcript RAG path. summary/qa/transcript are explicit-only; calendar is
  // schedule/date questions (market-wide, single-ticker, or range).
  let topic = validTopics.includes(params.topic) ? params.topic : "transcript_qa";

  const hasTicker =
    typeof params?.ticker === "string" && params.ticker.trim().length > 0;

  if (
    topic !== "calendar" &&
    !hasTicker &&
    userQ &&
    looksLikeEarningsCalendarQuery(userQ)
  ) {
    topic = "calendar";
    params.topic = "calendar";
    params.date = resolveCalendarDateFromQuery(userQ, easternToday());
    delete params.ticker;
    logger.info("📅 EARNINGS → calendar (fallback: no ticker + calendar query)");
  }

  // Safety net: classifier sometimes leaves topic=summary/transcript_qa on a
  // date/scheduling question ("rivian q1 2025 earning date"). Route those to the
  // calendar path (5-topic taxonomy: date/WHEN questions are calendar). With a
  // ticker → that company's schedule; without → market calendar.
  if (
    (topic === "summary" || topic === "qa" || topic === "transcript" || topic === "transcript_qa") &&
    userQ &&
    looksLikeEarningsDateQuery(userQ)
  ) {
    logger.info(`📅 EARNINGS → calendar (coerced from ${topic}: looks like an earnings-date question)`);
    topic = "calendar";
    params.topic = "calendar";
  }

  if (topic === "calendar") {
    // Single-ticker calendar = a company's earnings-call SCHEDULE (a list of
    // dates), distinct from a market date's company list. Hit the SmartNews
    // ticker calendar DATA endpoint and build the schedule on our side.
    if (hasTicker) {
      const tkr = String(params.ticker).toUpperCase().trim();
      const direction =
        params.direction === "upcoming" || params.direction === "past" ? params.direction : undefined;
      const rows = await fetchSmartnewsTickerCalendar(tkr, { upcoming: direction === "upcoming" });
      return buildTickerCalendarAnswer(tkr, rows, params.lang === "zh", logLabel, startTime, direction);
    }

    // Range calendar (week / month / quarter) — coerce attached months/start/end.
    if (Array.isArray(params.months) && params.months.length > 0 && params.start && params.end) {
      return await buildRangeCalendarAnswer(params, logLabel, startTime);
    }

    // Tolerate a full ISO timestamp from the LLM (e.g. "2026-06-22T00:00:00Z"):
    // take the leading YYYY-MM-DD so a stray time component doesn't fail the
    // check and silently collapse "tomorrow" back to today.
    const datePrefix =
      typeof params.date === "string" ? params.date.trim().slice(0, 10) : "";
    const rawDate = /^\d{4}-\d{2}-\d{2}$/.test(datePrefix) ? datePrefix : easternToday();
    // Earnings calendar is now sourced from SmartNews (enriched single-date
    // endpoint: company name + fiscal year/quarter + market cap), per the
    // "backend fully on SmartNews" migration. See fetchSmartnewsDateCalendar.
    const calendar = await fetchSmartnewsDateCalendar(rawDate);
    data = {
      success: true,
      topic: "calendar",
      date: rawDate,
      source: "smartnews",
      calendar,
    };

    // FALLBACK (reserved — NOT wired yet): the previous implementation fetched
    // the Nasdaq calendar in-process. Kept commented so it can be restored as a
    // SmartNews failover later. When re-enabling, do NOT loop back via
    // getLocalApiBase() (PORT may mismatch the dev UI port → dropped data and a
    // bogus "no API" answer); call fetchNasdaqEarningsCalendar directly:
    //   const calendar = await fetchNasdaqEarningsCalendar(rawDate);
    //   data = { success: true, topic: "calendar", date: rawDate, source: "nasdaq", calendar };

    logger.info(`  ✓ ${logLabel} calendar ${rawDate} via smartnews (${Date.now() - startTime}ms)`);
    return data;
  }

  // ── Multi-quarter fan-out (fires for any topic with ticker) ─────────────
  // Detect "AAPL Q1, Q2, Q3, Q4 2025 revenue" before topic branching.
  {
    const multiQPattern = new RegExp("\\bq[1-4][\\s,]+(?:(?:and|,)?\\s*q[1-4][\\s,]*){1,3}", "gi");
    const multiQMatch = (userQ || "").match(multiQPattern);
    const yearPattern = new RegExp("\\b(20\\d{2})\\b");
    const yearMatch = (userQ || "").match(yearPattern);
    if (multiQMatch && hasTicker) {
      const qNums: number[] = [];
      ((userQ || "") + " " + (params.question || ""))
        .replace(new RegExp("q([1-4])", "gi"), (_m: string, n: string) => { qNums.push(parseInt(n, 10)); return ""; });
      const seen: Record<number, boolean> = {};
      const uniqueQs: number[] = qNums.filter(n => { if (seen[n]) return false; seen[n] = true; return true; }).sort();
      const yr = yearMatch ? parseInt(yearMatch[1], 10) : params.year;
      const tkr = String(params.ticker).toUpperCase().trim();
      const metricQuery = (userQ || "").replace(/\bq[1-4]\b/gi, "").replace(/\b20\d{2}\b/, "").trim();
      logger.info(`  → EARNINGS multi-quarter fan-out: ${tkr} ${yr} Qs=${uniqueQs}`);
      const smartnewsAsk = SMARTNEWS_FALLBACK_API_BASE + "/api/earnings/ask";
      const quarterResults = await Promise.all(
        uniqueQs.map(async (q) => {
          const body = {
            ticker: tkr,
            year: yr,
            quarter: `Q${q}`,
            question: `What was ${tkr}'s ${metricQuery || "revenue and earnings"} in Q${q} ${yr}?`,
          };
          try {
            const r = await fetch(smartnewsAsk, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(body),
              signal: AbortSignal.timeout(60000),
            });
            const json = await r.json();
            return { quarter: `Q${q}`, year: yr, ...json };
          } catch (e) {
            return { quarter: `Q${q}`, year: yr, hasAnswer: false, answer: "Unavailable", error: String(e) };
          }
        }),
      );
      data = {
        topic: "multi_quarter_ask",
        ticker: tkr,
        year: yr,
        quarters: quarterResults,
        question: userQ || params.question,
      };
      logger.info(`  ✓ EARNINGS multi-quarter (${uniqueQs.length} quarters, ${Date.now() - startTime}ms)`);
      return data;
    }
  }

  // transcript_qa: free-form earnings question (incl. multi-company
  // comparison). Call SmartNews /api/earnings/ask DIRECTLY — it parses
  // ticker/company/comparison from the question itself and supports
  // multi-company RAG. The LOCAL /api/earnings/ask wrapper is single-ticker
  // (400s without a ticker, then we'd only reach SmartNews via fallback), so
  // we skip it entirely and go straight to SmartNews.
  if (topic === "transcript_qa") {
    const tqaQuestion =
      (typeof params.question === "string" && params.question.trim().length > 0
        ? params.question.trim()
        : "") || userQ || `${params.ticker || ""} earnings`.trim();
    const tqaBody: Record<string, any> = {
      question: tqaQuestion,
      language: params.lang || "en",
    };
    if (hasTicker) tqaBody.ticker = String(params.ticker).toUpperCase().trim();
    if (typeof params.year === "number") tqaBody.year = params.year;
    if (typeof params.quarter === "number") tqaBody.quarter = `Q${params.quarter}`;
    const tqaUrl = `${SMARTNEWS_FALLBACK_API_BASE}/api/earnings/ask`;
    logger.info(`  → ${logLabel} 请求 smartnews ask (transcript_qa): ${tqaUrl}`);
    try {
      response = await fetch(tqaUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(tqaBody),
        signal: AbortSignal.timeout(120000),
      });
      const tqaText = await response.text();
      if (!response.ok) {
        throw new Error(
          `EARNINGS transcript_qa upstream failed: ${response.status} ${response.statusText} :: ${tqaText.slice(0, UPSTREAM_ERROR_BODY_LIMIT)}`,
        );
      }
      const tqaJson = JSON.parse(tqaText);
      data = {
        ...tqaJson,
        topic: "ask",
        source: normalizeEarningsSource(tqaJson.source),
        ticker: tqaBody.ticker || tqaJson.ticker,
        year: tqaBody.year ?? tqaJson.year,
        quarter: tqaBody.quarter ?? tqaJson.quarter,
        question: tqaQuestion,
      };
      logger.info(
        `  ✓ ${logLabel} transcript_qa (source=${data.source ?? "?"}, hasAnswer=${data.hasAnswer ?? "?"}, ${Date.now() - startTime}ms)`,
      );
    } catch (tqaErr) {
      const errMsg = tqaErr instanceof Error ? tqaErr.message : String(tqaErr);
      logger.warn(`⚠️ ${logLabel} transcript_qa failed (${Date.now() - startTime}ms): ${errMsg}`);
      data = {
        topic: "ask",
        hasAnswer: false,
        answer:
          params.lang === "zh"
            ? "财报问答服务暂时不可用，请稍后再试。"
            : "The earnings Q&A service is temporarily unavailable. Please try again shortly.",
        source: "error",
        question: tqaQuestion,
        ticker: tqaBody.ticker,
        year: tqaBody.year,
        quarter: tqaBody.quarter,
        references: [],
        citations: [],
        thinking: errMsg.slice(0, 500),
      };
    }
    return data;
  }

  // summary / qa / transcript → DB-backed structured cards, with a smartnews
  // ask fallback (so we never drop into the multi-module LLM Investment Brief).
  // The two attempts use DIFFERENT bodies, so this is per-attempt failover:
  //   1. local /api/earnings/query  (structured DB card; success:false → fail)
  //   2. smartnews /api/earnings/ask (reshaped body; response wrapped as topic:"ask")
  const fallbackQuestion =
    (typeof params.question === "string" && params.question.trim().length > 0
      ? params.question.trim()
      : "") || userQ || `${params.ticker || ""} earnings ${topic}`.trim();
  const fallbackBody: Record<string, any> = { question: fallbackQuestion };
  if (hasTicker) fallbackBody.ticker = String(params.ticker).toUpperCase().trim();
  if (typeof params.year === "number") fallbackBody.year = params.year;
  if (typeof params.quarter === "number") fallbackBody.quarter = `Q${params.quarter}`;

  try {
    return await fetchJsonWithFallback(
      [
        {
          url: `${localApiBase}/api/earnings/query`,
          init: {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ ...params, topic, lang: params.lang || "en" }),
          },
          timeoutMs: 35000,
          parse: (raw) => {
            const d = raw as any;
            if (d?.success === false) {
              throw new Error(d?.error || `${topic} upstream returned success=false`);
            }
            logger.info(`  ✓ ${logLabel} (${Date.now() - startTime}ms)`);
            return d;
          },
        },
        {
          url: `${SMARTNEWS_FALLBACK_API_BASE}/api/earnings/ask`,
          init: {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(fallbackBody),
          },
          timeoutMs: 120000,
          parse: (raw) => {
            const fbJson = raw as any;
            const wrapped = {
              ...fbJson,
              topic: "ask",
              source: normalizeEarningsSource(fbJson.source),
              ticker: fallbackBody.ticker || fbJson.ticker,
              year: fallbackBody.year ?? fbJson.year,
              quarter: fallbackBody.quarter ?? fbJson.quarter,
              question: fallbackQuestion,
              fallbackFrom: topic,
            };
            logger.info(
              `  ✓ ${logLabel} ask-fallback (source=${wrapped.source ?? "?"}, hasAnswer=${wrapped.hasAnswer ?? "?"}, ${Date.now() - startTime}ms)`,
            );
            return wrapped;
          },
        },
      ],
      { timeoutMs: 35000, label: logLabel, errorTag: topic, bodyLogLimit: UPSTREAM_ERROR_BODY_LIMIT },
    );
  } catch (err) {
    const errors = err instanceof UpstreamFallbackError ? err.errors : [];
    const structuredFailureReason =
      errors[0]?.message || (err instanceof Error ? err.message : String(err));
    const fbMsg = errors[errors.length - 1]?.message || structuredFailureReason;
    logger.warn(`⚠️ ${logLabel} ${topic} + ask-fallback both failed: ${structuredFailureReason} | ${fbMsg}`);
    // Honest error card; keeps the direct-card path so we don't fall
    // through to the LLM brief.
    return {
      topic: "ask",
      hasAnswer: false,
      answer:
        params.lang === "zh"
          ? `财报数据暂时不可用：${structuredFailureReason}`
          : `Earnings data is unavailable right now: ${structuredFailureReason}`,
      source: "error",
      question: fallbackQuestion,
      ticker: fallbackBody.ticker,
      year: fallbackBody.year,
      quarter: fallbackBody.quarter,
      references: [],
      citations: [],
      thinking: `${structuredFailureReason} | fallback: ${fbMsg}`.slice(0, 500),
    };
  }
}
