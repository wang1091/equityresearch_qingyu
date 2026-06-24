// RenderPlan — the post-fetch half of the planner (PLAN_CONSOLIDATION_PLAN.md Step 4).
// resolvePlan answers "what to do" before the fetch; resolveRenderPlan answers "how does
// this turn render" once the data is in hand. Together they make the turn's decisions a
// pair of pure, typed, testable values (pre-fetch plan + post-fetch render plan) with the
// IO (onChunk/onPayload/persist/generate) living in the chatStream wrapper.
//
// This folds the chatStream direct-card gate + dispatch decision out of the ~250-line
// inline block: the gate, the api-failure short-circuit, the post-fetch data-shape guards
// (isSingleEarningsAnswer / isSingleStockPicker), and the branch precedence all become a
// pure function. The wrapper then just `switch`es on the chosen kind. No behavior change —
// the decision is byte-equivalent to the old conditionals.
//
// PURE: depends only on (plan, apiData, capability flags) + the pure cardFormatter
// predicates. The one render-time failure it cannot foresee — formatDataAsCard returning
// empty — stays a downgrade in the wrapper: a `html_card` plan may fall back to `llm`.
import type { ResolvedPlan } from "./resolvePlan";
import { isDirectCardSupported, isDirectCardApiFailure } from "./cardFormatter";

// Sources migrated off backend HTML formatters onto the generic structured
// `source_card` channel (frontend renders). Grows one entry per migration until
// the html_card path is empty. See docs/CARD_RENDER_MIGRATION_PLAN.md.
const STRUCTURED_CARD_SOURCES = new Set<string>([
  "RATING",
  "STOCK_PRICE",
  "VALUATION",
  "PERFORMANCE",
  "FDA",
  "TRENDING",
  "MARKET_DATA",
  "RUMOR",
  "EARNINGS",
  "COMPETITIVE",
  "STOCK_PICKER",
]);

export type RenderPlan =
  // Structured payload streamed via onPayload (frontend renders the rich card).
  | { kind: "news_v2"; source: string }
  // Generic structured card streamed via onPayload (frontend renderer registry).
  // Migration target: sources move here off the HTML path (see CARD_RENDER_MIGRATION_PLAN.md).
  | { kind: "source_card"; source: string }
  // HTML card streamed via onChunk (formatDataAsCard). May downgrade to llm at render time.
  | { kind: "html_card"; source: string }
  // Fall through to LLM generation (specialMode / unified — already derived in the plan).
  | { kind: "llm" };

export interface RenderPlanOptions {
  /** Whether a structured-payload sink (onPayload) is wired — required for the
   *  news_v2 / competitive / stock_picker channels; without it they degrade to html_card. */
  hasStructuredSink: boolean;
  /** The ENABLE_DIRECT_CARD flag (process.env.ENABLE_DIRECT_CARD !== "false"). */
  directCardEnabled: boolean;
}

const LLM: RenderPlan = { kind: "llm" };

/**
 * Decide the render channel for a turn given its plan and the fetched data. Mirrors the
 * chatStream direct-card decision exactly (gate → api-failure short-circuit → branch
 * precedence: NEWS → COMPETITIVE → STOCK_PICKER → html_card → llm).
 */
export function resolveRenderPlan(
  plan: ResolvedPlan,
  apiData: Record<string, any> | null,
  opts: RenderPlanOptions,
): RenderPlan {
  // Gate: direct cards are only for a single-intent turn that actually fetched data.
  if (!opts.directCardEnabled || !plan.guards.isSingleIntent || !apiData) return LLM;
  const source = plan.fetch[0]?.source;
  if (!source) return LLM;
  const payload = apiData[source];
  const isObject = !!payload && typeof payload === "object" && !Array.isArray(payload);

  // Post-fetch data-shape guards (pure predicates on the fetched payload). EARNINGS
  // ask/transcript_qa and a valid STOCK_PICKER payload are single, already-synthesized
  // answers — they bypass the comparison/multi-ticker eligibility below.
  const isSingleEarningsAnswer =
    source === "EARNINGS" && isObject && (payload.topic === "ask" || payload.topic === "transcript_qa");
  const isSingleStockPicker = source === "STOCK_PICKER" && isObject && !payload.error;

  const eligible =
    isSingleEarningsAnswer ||
    isSingleStockPicker ||
    (!plan.guards.isComparison && (!plan.guards.isMultiTicker || plan.guards.isRumorOnly));
  if (!eligible) return LLM;

  // TRENDING always goes through the card path (its formatter handles error/timeout
  // states); other sources with a failed/empty payload fall back to the LLM.
  const trendingBypass = source === "TRENDING";
  if (isDirectCardApiFailure(payload) && !trendingBypass) return LLM;

  // Dispatch precedence (matches the inline if-cascade). The structured channels need a
  // sink; without one they fall through to html_card / llm.
  if (source === "NEWS" && opts.hasStructuredSink) return { kind: "news_v2", source };
  // COMPETITIVE folded onto the generic source_card channel (handled by the
  // STRUCTURED_CARD_SOURCES dispatch below); a success:false payload is already
  // short-circuited to LLM by isDirectCardApiFailure above.
  // STOCK_PICKER folded onto the generic source_card channel (STRUCTURED_CARD_SOURCES
  // dispatch below). isSingleStockPicker still gates eligibility above (a non-error
  // single/comparison picker is card-eligible; composite intents synthesize text).
  // Migrated structured-card sources (RATING, …) emit a generic source_card payload
  // when a sink exists; without one they fall through to the HTML card below.
  if (STRUCTURED_CARD_SOURCES.has(source) && opts.hasStructuredSink) {
    return { kind: "source_card", source };
  }
  if (isDirectCardSupported(source)) return { kind: "html_card", source };
  return LLM;
}
