/**
 * Valuation shared module — the wire contract for the `POST /api/full-valuation`
 * response. Single source of truth mirroring `valuation-api/fastapi_app.py`,
 * imported by both server (apiCaller / simplify / route) and client (valuation
 * cards) so neither end drifts from the Python backend.
 */
export {
  type ValuationResponse,
  type ValuationDcf,
  type ValuationRelative,
  type ValuationAiRecommendation,
  type ValuationAnalyst,
  type RelativeEstimate,
  type PeerStat,
  type DcfAssumptions,
  type ValuationTableRow,
} from "./schema";
