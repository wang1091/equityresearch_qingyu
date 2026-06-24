/**
 * Wire contract for the analyst-RATING response (the rich `detail` card shape
 * built in `server/quotes/service.ts`, ~L186-237). Single source of truth so the
 * card formatter (`server/agent/formatters/rating.ts`) and the LLM simplifier
 * (`simplifyRating`) read the SAME shape instead of drifting apart — the bug this
 * type prevents: simplifyRating was still reading the OLD legacy shape
 * (`data.targetPrice` / `data.valuation` as a string / `data.consensus`), so the
 * LLM got 6 undefined fields while the formatter (already on this shape) was fine.
 *
 * NOTE: `target` and `upside` are currently hardcoded `null` upstream (service.ts
 * L190-191) — they're part of the contract but not yet populated.
 */

export interface RatingTechnicalSignal {
  direction: string | null; // "Bullish" | "Bearish" | ...
  score: number | null;
  desc: string | null;
}

export interface RatingTechnical {
  short: RatingTechnicalSignal;
  mid: RatingTechnicalSignal;
  long: RatingTechnicalSignal;
  vsSector: string | null;
  vsIndex: string | null;
}

export interface RatingLevels {
  support: number | null;
  resistance: number | null;
  stopLoss: number | null;
}

export interface RatingValuation {
  status: string | null; // "Overvalued" | "Undervalued" | "Fairly Valued"
  discount: string | null; // pre-formatted, e.g. "-1%"
}

/** Yahoo company-insight sub-scores (0..1). Keys known; some may be null. */
export interface RatingScores {
  innovativeness?: number | null;
  hiring?: number | null;
  sustainability?: number | null;
  insiderSentiments?: number | null;
  earningsReports?: number | null;
  dividends?: number | null;
  [key: string]: number | null | undefined;
}

export interface RatingNews {
  headline: string | null;
  date: string | null;
}

export interface RatingReport {
  title: string | null;
  provider: string | null;
  date: string | null;
}

/** Full analyst-RATING response (rich detail card). */
export interface RatingResponse {
  success: boolean;
  ticker: string;
  price: number | null;
  target: number | null; // analyst target — currently null upstream
  upside: number | null; // % vs target — currently null upstream
  rating: string | null; // "HOLD" | "BUY" | "SELL" | ...
  provider: string | null;
  technical: RatingTechnical;
  levels: RatingLevels;
  valuation: RatingValuation;
  scores: RatingScores;
  bullish: string[]; // analyst pros (already capped to 3 upstream)
  bearish: string[]; // analyst cons
  news: RatingNews | null;
  reports: RatingReport[];
  sector: string | null;
}
