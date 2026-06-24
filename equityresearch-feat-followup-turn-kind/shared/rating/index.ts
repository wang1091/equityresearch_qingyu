/**
 * Rating shared module — wire contract for the analyst-RATING rich card response.
 * Single source of truth (mirrors server/quotes/service.ts) so the card formatter
 * and the LLM simplifier read the same shape and never drift apart again.
 */
export {
  type RatingResponse,
  type RatingTechnical,
  type RatingTechnicalSignal,
  type RatingLevels,
  type RatingValuation,
  type RatingScores,
  type RatingNews,
  type RatingReport,
} from "./schema";
