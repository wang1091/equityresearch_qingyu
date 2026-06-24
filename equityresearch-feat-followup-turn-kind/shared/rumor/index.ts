/**
 * Rumor shared module — structured contract + normalizer for the RUMOR card.
 * The raw upstream payload is semi-structured; normalizeRumorPayload parses it
 * into RumorCardData (see schema.ts) so server + client read one shape.
 */
export { type RumorCardData } from "./schema";
export { normalizeRumorPayload } from "./normalize";
