/**
 * Wire contract for the RUMOR card. Unlike the other sources, the upstream rumor
 * payload is semi-structured — either a flat detect-rumor object, or a richer
 * chatbot payload whose `report.markdown` / `_analysis.fullAnalysis` is a markdown
 * or narrative blob that must be PARSED into fields. `normalizeRumorPayload`
 * (shared/rumor/normalize.ts) does that parsing so both the source_card projector
 * and the frontend renderer read one structured shape (the old server formatter
 * parsed it inline). See docs/CARD_RENDER_MIGRATION_PLAN.md.
 */

/** Structured rumor-verification result, normalized from the raw upstream payload. */
export interface RumorCardData {
  title: string;
  /** "Verified" / "Debunked" / "Unverified" / "Mixed" … (raw upstream label). */
  verdictLabel: string;
  rumor: string;
  /** "High" / "Low" / "Unknown" … (display string, not numeric). */
  confidence: string;
  summary: string;
  facts: string[];
  analysis: string;
  conclusion: string;
  /** Source URLs, in citation order. */
  sources: string[];
  /** cross_validation.agreement, when present. */
  crossValidation: string | null;
  /** When the payload only had raw markdown (no parsed sections), the sources-
   *  stripped markdown to render as-is. Empty otherwise. */
  fallbackMarkdown: string;
}
