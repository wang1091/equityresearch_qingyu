/**
 * Wire contract for the valuation backend's `POST /api/full-valuation` response.
 *
 * Single source of truth for the shape, mirroring `valuation-api/fastapi_app.py`
 * (the `full_valuation` handler's return, ~L703-748). Imported by both server
 * (apiCaller / simplify / route) and client (InvestmentBrief + valuation cards)
 * so the two ends never drift from the Python backend again — the stale field
 * paths in `server/agent/simplify/valuation.ts` (reading `data.details.*` /
 * `data.upside_percentage` that this contract does NOT emit) are exactly the
 * drift this type is meant to prevent.
 *
 * Pure structure only. Picking which subset to feed the LLM (simplify) and how
 * the frontend renders it are separate, later steps — this file just lands the
 * shape so those steps have an authoritative reference.
 *
 * Note on `upside_percentage`: the backend emits it as a STRING (e.g. "-87.9"),
 * pre-formatted to one decimal — not a number. `decision` is an uppercase string
 * ("OVERVALUED" / "UNDERVALUED" / a fair-value band label).
 */

/** A row in a DCF/relative table: a `Breakdown` label plus period/metric columns. */
export type ValuationTableRow = Record<string, string | number | null>;

/** DCF model assumptions. Keys are known but the numeric scale varies by source
 *  (live DeepSeek vs the backend fallback), so values stay loosely typed. */
export interface DcfAssumptions {
  beta?: number;
  revenue_growth?: number;
  opex_growth?: number;
  gross_margin?: number;
  tax_rate?: number;
  terminal_growth?: number;
  projection_years?: number;
  [key: string]: number | undefined;
}

export interface ValuationDcf {
  method_name: string; // "DCF Analysis"
  target_price: number;
  upside_percentage: string; // "-87.9"
  cost_of_equity: number;
  terminal_value: number;
  npv: number;
  assumptions: DcfAssumptions;
  quarterly_table: ValuationTableRow[];
  annual_table: ValuationTableRow[];
  dcf_table: ValuationTableRow[];
  company_name: string;
}

/** One peer-multiple-derived price estimate. */
export interface RelativeEstimate {
  price: number;
  multiple: string; // "EV / Sales"
  value: string; // "6.91x"
  target_current: number;
  peer_median: number;
}

/** Per-multiple distribution across the peer set. */
export interface PeerStat {
  mean: number;
  median: number;
  min: number;
  max: number;
}

export interface ValuationRelative {
  method_name: string; // "Relative Valuation"
  high_estimate: number;
  low_estimate: number;
  median_estimate: number;
  target_price: number;
  upside_percentage: string; // "-73.2"
  peers: string[];
  peer_count: number;
  has_revenue: boolean;
  ttm_revenue: number;
  valuation_range: string; // "$66.35 – $286.14"
  all_estimates: RelativeEstimate[];
  /** One row per company (target + peers); a `Ticker` label plus ratio columns. */
  comparison_table: ValuationTableRow[];
  /** Keyed by multiple name (e.g. "EV / Sales") → its peer-set distribution. */
  peer_stats: Record<string, PeerStat>;
}

/** The blended recommendation — the headline verdict the answer should surface. */
export interface ValuationAiRecommendation {
  chosen_method: string | null; // "DCF" | "RelativeMedian" | ...
  chosen_price: number;
  upside_percentage: string; // "-87.9"
  decision: string; // "OVERVALUED" | "UNDERVALUED" | fair-value band label
  valuation_gap_pct: number;
  confidence: number; // 0..1
  rationale: string;
}

/** Sell-side analyst consensus. `null` when the upstream had no analyst data. */
export interface ValuationAnalyst {
  recommendation_key: string | null;
  recommendation_mean: number | null;
  target_low_price: number | null;
  target_mean_price: number | null;
  target_median_price: number | null;
  target_high_price: number | null;
  number_of_analyst_opinions: number | null;
  buy_count: number;
  hold_count: number;
  sell_count: number;
}

/** Full `POST /api/full-valuation` response. */
export interface ValuationResponse {
  success: boolean;
  ticker: string;
  current_price: number;
  valuations: {
    dcf: ValuationDcf;
    relative: ValuationRelative;
  };
  ai_recommendation: ValuationAiRecommendation;
  analyst: ValuationAnalyst | null;
}
