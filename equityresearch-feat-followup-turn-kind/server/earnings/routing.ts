import { logger } from "../utils";
import {
  looksLikeEarningsCalendarQuery,
  looksLikeEarningsCalendarForTicker,
  looksLikeEarningsDateQuery,
  looksLikeNextEarningsForTicker,
  resolveCalendarDateFromQuery,
  resolveCalendarRangeFromQuery,
  easternToday,
} from "../../shared/earnings";

/**
 * B-layer earnings routing correction (the "coerce" step).
 *
 * Runs after the LLM classifier and deterministically overrides/normalizes the
 * EARNINGS routing. Extracted into its own light module so it can be unit-tested
 * offline (depends only on `logger` + the shared regex detectors) — see
 * `scripts/earnings-routing-regression.mts`.
 *
 * NOTE: this function is the subject of the LLM-first routing refactor; behaviour
 * here is intentionally locked by the regression suite before any change.
 */
/**
 * Bounded keyword detection for single-ticker calendar direction.
 * "下次 / next / upcoming / when is" → upcoming; "上次 / last / previous / when was"
 * → past; otherwise undefined = full schedule. (TS handles this bounded vocab; the
 * LLM's `direction`, when it survives, takes precedence — see the coerce block.)
 */
function deriveCalendarDirection(query: string): "upcoming" | "past" | undefined {
  const s = String(query || "").toLowerCase();
  if (/上次|上一次|last|previous|prior|when\s+was|past\s+earning/.test(s)) return "past";
  if (/下次|下一次|next|upcoming|when\s+(is|will|does|are)/.test(s)) return "upcoming";
  return undefined;
}

/** Broad earnings-calendar questions must not hit per-ticker /api/earnings/query without a ticker. */
export function coerceMarketEarningsCalendar(
  classification: Record<string, any>,
  userMessage: string,
): void {
  // NOTE: Per-ticker "when is the next earnings call" used to short-circuit to
  // topic=next (our local Nasdaq 90-day window). Removed — that lookup was
  // missing many tickers (e.g. AAPL Q3 2026), so we now route these through
  // smartnews /api/earnings/ask, which has both calendar and web access. The
  // single-intent ask coercion below picks them up via primary_focus=EARNINGS.

  // Single-ticker earnings SCHEDULE — the unified "calendar" topic now absorbs
  // what used to be `next` and date-`ask`. Fires for: "X earnings calendar /
  // schedule", "X 下次/上次财报", "X next/last earnings", "X earnings (call) date".
  // Checked BEFORE the market-wide block so a named company routes to THAT
  // company's schedule. Sets topic=calendar WITH the ticker (+ direction) so
  // service.ts hits the SmartNews ticker calendar DATA endpoint — never the
  // ask/curated path. Runs regardless of primary_focus so a classifier misfire
  // (topic=summary/GENERAL) is rescued, as long as exactly one ticker survived.
  // Respects the multi-intent guard.
  //
  // direction: prefer the classifier's (LLM judges 下次 vs 上次 semantically);
  // fall back to TS keyword detection. routingPolicy strips it from api_params for
  // calendar, so the TS fallback is what usually applies — bounded keywords, safe.
  {
    const tickers =
      Array.isArray(classification.tickers)
        ? classification.tickers.map((t: any) => String(t).toUpperCase().trim()).filter(Boolean)
        : [];
    const coIntents = Array.isArray(classification.required_data)
      ? classification.required_data.filter((s: any) => s !== "EARNINGS" && s !== "GENERAL")
      : [];
    const existing =
      classification.api_params &&
      typeof classification.api_params === "object" &&
      classification.api_params.EARNINGS &&
      typeof classification.api_params.EARNINGS === "object" &&
      !Array.isArray(classification.api_params.EARNINGS)
        ? classification.api_params.EARNINGS
        : {};
    // Fire on a TS detector OR the classifier itself having chosen calendar (the
    // detectors miss some phrasings like "上次财报是什么时候" — the LLM catches those).
    const isTickerCalendar =
      looksLikeEarningsCalendarForTicker(userMessage) ||
      looksLikeNextEarningsForTicker(userMessage) ||
      looksLikeEarningsDateQuery(userMessage) ||
      existing.topic === "calendar";
    if (isTickerCalendar && tickers.length === 1 && coIntents.length === 0) {
      const llmDir =
        existing.direction === "upcoming" || existing.direction === "past"
          ? existing.direction
          : undefined;
      const direction = llmDir ?? deriveCalendarDirection(userMessage);
      classification.required_data = ["EARNINGS"];
      classification.primary_focus = "EARNINGS";
      classification.need_api = true;
      classification.tickers = tickers;
      classification.intents = ["EARNINGS"];
      classification.api_params = {
        EARNINGS: { topic: "calendar", ticker: tickers[0], ...(direction ? { direction } : {}) },
      };
      logger.info(
        `📅 Coerced classification to EARNINGS ticker calendar (${tickers[0]}${direction ? `, ${direction}` : ""})`,
      );
      return;
    }
  }

  // Multi-intent guard (same spirit as bug 003): only collapse to a market-wide
  // calendar card when EARNINGS is the sole data source. If the query also asks
  // for NEWS/VALUATION/etc., leave the classification intact for multi-source
  // handling. (GENERAL is treated as "no real co-intent" so misfires still get
  // rescued.)
  const marketCalCoIntents = Array.isArray(classification.required_data)
    ? classification.required_data.filter((s: any) => s !== "EARNINGS" && s !== "GENERAL")
    : [];
  if (looksLikeEarningsCalendarQuery(userMessage) && marketCalCoIntents.length === 0) {
    const defaultIso = easternToday();
    classification.required_data = ["EARNINGS"];
    classification.primary_focus = "EARNINGS";
    classification.need_api = true;
    classification.tickers = [];
    classification.intents = ["EARNINGS"];
    // Range query ("next week / this month / Q4")? Resolve it to a concrete
    // date range (TS date math) and let service.ts fan out over the months.
    // Otherwise fall back to the single-day calendar.
    const range = resolveCalendarRangeFromQuery(userMessage, defaultIso);
    classification.api_params = {
      ...(classification.api_params && typeof classification.api_params === "object"
        ? classification.api_params
        : {}),
      EARNINGS: range
        ? { topic: "calendar", grain: range.grain, start: range.start, end: range.end, months: range.months, label: range.label }
        : { topic: "calendar", date: resolveCalendarDateFromQuery(userMessage, defaultIso) },
    };
    logger.info(
      range
        ? `📅 Coerced classification to EARNINGS calendar range (${range.label})`
        : "📅 Coerced classification to EARNINGS calendar (market-wide query)",
    );
    return;
  }

  // Earnings-focused queries always render via the EARNINGS card path —
  // never the multi-module LLM Investment Brief. Collapse to single-intent.
  // Topic selection:
  //   - date / "when is the next call" questions → topic=ask (smartnews)
  //   - structured requests (summary/qa/transcript/transcript_qa from
  //     classifier) → keep as-is, route to /api/earnings/query (DB-backed
  //     structured cards). apiCaller falls back to smartnews ask on DB failure.
  //   - everything else → topic=ask (smartnews)
  if (
    classification.primary_focus === "EARNINGS" ||
    (Array.isArray(classification.required_data) &&
      classification.required_data[0] === "EARNINGS")
  ) {
    // Multi-intent guard (docs/bugs/003): when EARNINGS shares the request with
    // other sources (e.g. "AAPL earnings + AAPL-vs-MSFT valuation"), do NOT
    // collapse to a single-intent EARNINGS card. The collapse below rewrites
    // required_data to ["EARNINGS"] and api_params to a single EARNINGS object
    // built from the raw userMessage — which drops the co-intents AND discards
    // the classifier's per-source scoped EARNINGS.question. Leave the classifier
    // output intact here and let the normal multi-source fetch + LLM synthesis
    // run (apiCaller still defaults/normalizes the EARNINGS topic). Only a SOLE
    // EARNINGS intent takes the collapse path below.
    const coIntents = Array.isArray(classification.required_data)
      ? classification.required_data.filter((s: any) => s !== "EARNINGS")
      : [];
    if (coIntents.length > 0) {
      return;
    }

    const tickers =
      Array.isArray(classification.tickers) && classification.tickers.length > 0
        ? classification.tickers.map((t: any) => String(t).toUpperCase().trim()).filter(Boolean)
        : [];

    // Multi-ticker earnings comparison ("compare NVDA and AMD earnings"): do NOT
    // fan out per ticker. smartnews /api/earnings/ask is a full RAG endpoint that
    // parses the companies straight from the question (planQuery → companies[] →
    // fetchRagContextMultiCompany) and renders a side-by-side comparison itself.
    // So send ONE transcript_qa ask with the raw question and let it do the work.
    // tickers stays the full list for the intent chips only — apiCaller does not
    // fan out because api_params.EARNINGS is a single object, not an array.
    const earningsRaw = (classification.api_params as Record<string, any>)?.EARNINGS;
    const isMultiTickerEarnings =
      (Array.isArray(earningsRaw) && earningsRaw.length >= 2) || tickers.length >= 2;
    if (isMultiTickerEarnings) {
      classification.required_data = ["EARNINGS"];
      classification.primary_focus = "EARNINGS";
      classification.need_api = true;
      classification.tickers = tickers;
      classification.intents = ["EARNINGS"];
      classification.api_params = {
        EARNINGS: { topic: "transcript_qa", question: userMessage },
      };
      logger.info(
        `📊 EARNINGS comparison → single transcript_qa ask (smartnews resolves [${tickers.join(", ")}] from the question)`,
      );
      return;
    }

    const primary = tickers[0];
    const existingEarnings =
      classification.api_params &&
      typeof classification.api_params === "object" &&
      typeof classification.api_params.EARNINGS === "object" &&
      !Array.isArray(classification.api_params.EARNINGS)
        ? { ...classification.api_params.EARNINGS }
        : {};

    const structuredTopics = ["summary", "qa", "transcript", "transcript_qa"];
    const classifierTopic =
      typeof existingEarnings.topic === "string"
        ? existingEarnings.topic.toLowerCase().trim()
        : "";

    // year/quarter come straight from the classifier (api_params.EARNINGS).
    // The old regex backfill here was removed (A2): the classifier prompt now
    // owns period extraction from natural-language phrasings, and pinning the
    // period lets the server-side resolver still refuse to substitute a period
    // it has no data for. See docs/LLM_TS_DUPLICATION_INVENTORY.md.

    const isDateQuery =
      looksLikeEarningsDateQuery(userMessage) ||
      looksLikeNextEarningsForTicker(userMessage);

    let earningsParams: Record<string, any>;
    if (isDateQuery || !structuredTopics.includes(classifierTopic)) {
      // Force ask path for date/next questions OR when classifier didn't pick a
      // structured topic.
      earningsParams = {
        topic: "ask",
        question:
          typeof existingEarnings.question === "string" && existingEarnings.question.trim().length > 0
            ? existingEarnings.question
            : userMessage,
      };
      if (primary) earningsParams.ticker = primary;
      if (typeof existingEarnings.year === "number") earningsParams.year = existingEarnings.year;
      if (
        typeof existingEarnings.quarter === "number" ||
        typeof existingEarnings.quarter === "string"
      ) {
        earningsParams.quarter = existingEarnings.quarter;
      }
      logger.info(
        `📞 EARNINGS → ask (ticker=${primary || "—"}, ${isDateQuery ? "date query" : "no structured topic"})`,
      );
    } else if (classifierTopic === "transcript_qa") {
      // transcript_qa is the smartnews RAG path (/api/earnings/ask). Send the raw
      // user question — smartnews parses ticker/period/intent itself. Keep the
      // resolved ticker (it may have been resolved from history for a follow-up)
      // and any pinned period as hints; never rewrite the question.
      earningsParams = { topic: "transcript_qa", question: userMessage };
      if (primary) earningsParams.ticker = primary;
      if (typeof existingEarnings.year === "number") earningsParams.year = existingEarnings.year;
      if (
        typeof existingEarnings.quarter === "number" ||
        typeof existingEarnings.quarter === "string"
      ) {
        earningsParams.quarter = existingEarnings.quarter;
      }
      logger.info(`📞 EARNINGS → transcript_qa ask (ticker=${primary || "—"}, raw question)`);
    } else {
      // Structured curated docs (summary / qa / transcript) hit their dedicated
      // smartnews endpoints (ai-doc / ninjas transcript), which REQUIRE ticker +
      // period — so keep the classifier's structured params verbatim.
      earningsParams = { ...existingEarnings, topic: classifierTopic };
      if (primary) earningsParams.ticker = primary;
      logger.info(
        `📊 EARNINGS → ${classifierTopic} (ticker=${primary || "—"}, single-intent, DB-backed)`,
      );
    }

    classification.required_data = ["EARNINGS"];
    classification.primary_focus = "EARNINGS";
    classification.need_api = true;
    classification.tickers = primary ? [primary] : [];
    classification.intents = ["EARNINGS"];
    classification.api_params = { EARNINGS: earningsParams };
  }
}
