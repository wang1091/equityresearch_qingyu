// Provider abstraction. One generic interface (`Provider<I, R>`)
// instantiated for the two layers we have today (research, analysis).
//
// Tagged unions (#1 in latest review): provider returns an OUTCOME
// (success or failure, plain data) — the chain runner WRAPS that into a
// STAMPED form with providerId/providerModel embedded. No more in-place
// mutation of the provider's return value.

import type { ForcesObject, SourceCitation } from "../types/domain";

// ─────────────────────────────────────────────
// Generic provider shape
// ─────────────────────────────────────────────

export interface Provider<I, R> {
  readonly id: string;
  readonly model: string;
  // Optional self-routing. Return false to tell the chain runner to skip
  // this provider for this specific input (no network call).
  canHandle?(input: I): boolean;
  perform(input: I): Promise<R>;
}

// ─────────────────────────────────────────────
// Research layer
// ─────────────────────────────────────────────

export type ResearchErrorKind =
  | "auth"               // 401 / 403
  | "rate_limit"         // 429
  | "server"             // 5xx
  | "timeout"            // AbortSignal fired
  | "transport"          // network / DNS
  | "config"             // local config (e.g., API key missing)
  | "malformed_response" // upstream returned non-JSON / wrong shape
  | "unknown";

export interface ResearchInput {
  companyName: string;
  ticker?: string;
  additionalContext?: string;
}

// What a research provider RETURNS. Tagged union — caller MUST
// discriminate on `status`. No providerId/providerModel here — those
// belong to the runner's stamping, not the provider's output.
export type ResearchOutcome =
  | {
      status: "ok";
      content: string;
      sources: SourceCitation[];
      durationMs: number;
    }
  | {
      status: "empty";
      errorKind: ResearchErrorKind;
      durationMs: number;
    };

// What the chain runner returns — wraps an Outcome with provider attribution.
export interface StampedResearch {
  outcome: ResearchOutcome;
  providerId: string;
  providerModel: string;
}

export type ResearchProvider = Provider<ResearchInput, ResearchOutcome>;

// ─────────────────────────────────────────────
// Analysis layer
// ─────────────────────────────────────────────

export interface AnalysisInput {
  companyName: string;
  researchContext: string;
  additionalContext?: string;
  // Output language for analysis prose (industry / forces.analysis /
  // overall_assessment). Force scores and JSON keys are language-invariant.
  // "both" currently degrades to "en" — bilingual single-call output is
  // deferred per COMPETITIVE_API_CONTRACT.md §8.1 (low priority).
  lang?: "en" | "zh" | "both";
}

// Analysis providers throw on failure (vs research's empty-status). Their
// success outcome carries the parsed business object.
export interface AnalysisOutcome {
  company: string;
  industry: string;
  forces: ForcesObject;
  overall_assessment: string;
  durationMs: number;
}

// Runner-side wrap with provider attribution.
export interface StampedAnalysis {
  outcome: AnalysisOutcome;
  providerId: string;
  providerModel: string;
}

export type AnalysisProvider = Provider<AnalysisInput, AnalysisOutcome>;
