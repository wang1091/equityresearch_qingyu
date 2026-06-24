// VALUATION simplifier. Lives here (not in a source service module) because
// VALUATION is fetched inline in apiCaller's switch and has no service module.
//
// Curated LLM projection of a /api/full-valuation response. The shape it reads
// is the authoritative contract in `shared/valuation` (mirrors valuation-api/
// fastapi_app.py): top-level `current_price`, `valuations.{dcf,relative}`, and
// `ai_recommendation`. The OLD version read `data.details.*` / `data.verdict` /
// `data.upside_percentage` — paths the backend never emits — so every field came
// back null/undefined ("Fairly Valued" / "undefined%") and the LLM dutifully
// reported garbage. This rewrite fixes that drift.
//
// Philosophy mirrors simplifyStockPicker: NOT a truncated raw dump but a small,
// well-named summary of only what the answer needs — the headline verdict, the
// two methods' point estimates, and the rationale. The big tables (quarterly /
// annual / dcf / comparison / peer_stats / all_estimates) are intentionally
// dropped; they belong to the frontend valuation card, never the prompt.

/** Format a percentage-string field ("-87.9") as "-87.9%", or null when absent. */
const pct = (v: unknown): string | null =>
  v === null || v === undefined || v === "" ? null : `${v}%`;

/** Round a price to 2dp; null for non-finite — keeps 14-digit fake precision out of the prompt. */
const round2 = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) ? Math.round(v * 100) / 100 : null;

export function simplifyValuation(data: any): Record<string, any> {
  const ai = data?.ai_recommendation ?? {};
  const dcf = data?.valuations?.dcf ?? {};
  const rel = data?.valuations?.relative ?? {};
  const analyst = data?.analyst;
  return {
    ticker: data?.ticker,
    currentPrice: round2(data?.current_price),
    // Headline verdict = the blended recommendation (the chosen method's call).
    verdict: ai.decision ?? null, // "OVERVALUED" | "UNDERVALUED" | fair-value band label
    method: ai.chosen_method ?? null,
    fairValue: round2(ai.chosen_price),
    upside: pct(ai.upside_percentage),
    valuationGapPct: ai.valuation_gap_pct ?? null,
    confidence: ai.confidence ?? null,
    rationale: ai.rationale ?? null,
    // Per-method point estimates only — full tables stay out of the prompt.
    dcf: { fairValue: round2(dcf.target_price), upside: pct(dcf.upside_percentage) },
    relative: {
      median: round2(rel.median_estimate),
      range: rel.valuation_range ?? null,
      upside: pct(rel.upside_percentage),
      peers: Array.isArray(rel.peers) ? rel.peers : undefined,
    },
    // Sell-side consensus when the upstream had it (often null) — compact only.
    analyst: analyst
      ? {
          recommendation: analyst.recommendation_key ?? null,
          targetMean: round2(analyst.target_mean_price),
          targetLow: round2(analyst.target_low_price),
          targetHigh: round2(analyst.target_high_price),
          opinions: analyst.number_of_analyst_opinions ?? null,
        }
      : null,
  };
}
