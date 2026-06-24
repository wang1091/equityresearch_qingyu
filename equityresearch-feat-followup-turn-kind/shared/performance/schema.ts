/**
 * Wire contract for the PERFORMANCE response (server/performance/service.ts —
 * /api/performance/company-analysis). Single source of truth for formatter +
 * simplifier.
 *
 * `analysis.analysis` is a STRING that holds either a JSON object (the structured
 * primary-company analysis below) or free-form prose (legacy/fallback).
 * `metrics` is keyed ticker → metric name → period → value.
 */

/** Structured form of `analysis.analysis` once JSON-parsed. Fields are arrays of
 *  bullet strings (or a string), all optional — depends on the upstream LLM. */
export interface PerformanceStructuredAnalysis {
  ticker?: string;
  rating?: string;
  summary?: string[] | string;
  financial_performance?: string[] | string;
  peer_comparison_rank?: string[] | string;
  valuation_ratios?: string[] | string;
  conclusion?: string;
}

export interface PerformanceAnalysis {
  ticker: string;
  period?: string;
  /** JSON-stringified PerformanceStructuredAnalysis, or prose. */
  analysis: string;
  peers?: string[];
  language?: string;
  llm_provider?: string;
  timestamp?: string;
}

/** period label ("2026Q1" | "Current") → value. */
export type PerformanceMetricSeries = Record<string, number | null>;
/** ticker → metric name ("Gross Margin %", "EBIT", …) → series. */
export type PerformanceMetrics = Record<string, Record<string, PerformanceMetricSeries>>;

/** keymetrics-style peer takeaway. Present when peer-analysis succeeded; the card
 *  uses it as the analysis-text fallback when `analysis` is absent (Yahoo rate-limit). */
export interface PerformancePeerConclusion {
  en?: string;
  zh?: string;
  period?: string;
}

export interface PerformanceResponse {
  /** Optional: Yahoo-backed company-analysis is non-fatal and may be absent
   *  (rate-limited) — service.ts only includes the key when it resolved. */
  analysis?: PerformanceAnalysis;
  primaryTicker: string;
  peers: string[];
  metrics: PerformanceMetrics;
  peerConclusion?: PerformancePeerConclusion;
}
