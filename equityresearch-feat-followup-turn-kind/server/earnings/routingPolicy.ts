import {
  validateIsoDate,
  looksLikeEarningsCalendarQuery,
  resolveCalendarDateFromQuery,
  easternToday,
} from "../../shared/earnings";

export type EarningsTopic =
  | "summary"
  | "qa"
  | "transcript"
  | "transcript_qa"
  | "calendar";

interface NormalizeEarningsInput {
  query: unknown;
  requiredData: string[];
  tickers: string[];
  apiParams?: Record<string, any>;
}

interface NormalizeEarningsResult {
  apiParams: Record<string, any>;
}

const VALID_TOPICS: readonly string[] = [
  "summary",
  "qa",
  "transcript",
  "transcript_qa",
  "calendar",
];

function getValidTopic(params: any): EarningsTopic {
  const topic = params?.topic;
  return typeof topic === "string" && VALID_TOPICS.includes(topic)
    ? (topic as EarningsTopic)
    : "summary";
}

function normalizeEarningsParams(
  params: any,
  query: string,
  fallbackTicker?: string
): Record<string, any> {
  const normalized: Record<string, any> =
    params && typeof params === "object" ? { ...params } : {};

  if (!normalized.ticker && fallbackTicker) {
    normalized.ticker = fallbackTicker;
  }

  // topic comes from the classifier (validated). The old summary→transcript_qa
  // regex upgrade was removed (A3): the prompt makes transcript_qa the DEFAULT
  // and reserves summary for explicit "summary card" requests, so the LLM owns
  // this decision. See docs/LLM_TS_DUPLICATION_INVENTORY.md.
  const topic = getValidTopic(normalized);
  normalized.topic = topic;

  if (topic === "calendar") {
    delete normalized.question;
    delete normalized.ticker;
    const d = typeof normalized.date === "string" ? normalized.date.trim() : "";
    if (d && validateIsoDate(d)) {
      normalized.date = d;
    } else {
      delete normalized.date;
    }
    return normalized;
  }

  if (topic === "transcript_qa") {
    const existingQuestion =
      typeof normalized.question === "string" ? normalized.question.trim() : "";
    normalized.question = existingQuestion || query;
  } else {
    delete normalized.question;
  }

  return normalized;
}

export function normalizeEarningsRouting(
  input: NormalizeEarningsInput
): NormalizeEarningsResult {
  const baseApiParams =
    input.apiParams && typeof input.apiParams === "object"
      ? { ...input.apiParams }
      : {};

  if (!input.requiredData.includes("EARNINGS")) {
    return { apiParams: baseApiParams };
  }

  const queryText = typeof input.query === "string" ? input.query : "";

  if (looksLikeEarningsCalendarQuery(queryText)) {
    const defaultIso = easternToday();
    return {
      apiParams: {
        ...baseApiParams,
        EARNINGS: {
          topic: "calendar",
          date: resolveCalendarDateFromQuery(queryText, defaultIso),
        },
      },
    };
  }

  const earningsParams = baseApiParams.EARNINGS;

  if (Array.isArray(earningsParams)) {
    baseApiParams.EARNINGS = earningsParams.map((item: any, index: number) =>
      normalizeEarningsParams(
        item,
        queryText,
        input.tickers[index] || input.tickers[0]
      )
    );
  } else if (earningsParams && typeof earningsParams === "object") {
    baseApiParams.EARNINGS = normalizeEarningsParams(
      earningsParams,
      queryText,
      input.tickers[0]
    );
  } else if (input.tickers.length > 1) {
    baseApiParams.EARNINGS = input.tickers.map((ticker: string) =>
      normalizeEarningsParams({ ticker }, queryText, ticker)
    );
  } else {
    baseApiParams.EARNINGS = normalizeEarningsParams(
      input.tickers[0] ? { ticker: input.tickers[0] } : {},
      queryText
    );
  }

  return { apiParams: baseApiParams };
}
