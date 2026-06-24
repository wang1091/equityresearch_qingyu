// Wire-format DTOs: the JSON shapes that cross the HTTP boundary.
// Mirrors §3-§5 of COMPETITIVE_API_CONTRACT.md.

import type { ErrorCode } from "./contract";
import type { ForcesObject, SourceCitation } from "./domain";

export type Lang = "en" | "zh" | "both";

export interface CompetitiveAnalysisRequest {
  companyName?: string;
  ticker?: string;
  industry?: string;
  additionalContext?: string;
  lang?: Lang;
  verbose?: boolean;
}

export interface StepTimings {
  research_ms: number;
  analysis_ms: number;
}

export interface ResponseMeta {
  provider: string;
  research_provider: string | null;
  research_model: string | null;
  analysis_model: string;
  duration_ms: number;
  step_timings: StepTimings;
  version: string;
  // Present only when research_grounded=false. Helps operators diagnose
  // why research didn't return content.
  research_error_kind?: string;
  // Present when this response was served from the in-process cache
  // (see cache.ts). cache_age_ms is how old the cached entry was.
  cached?: boolean;
  cache_age_ms?: number;
}

export interface CompetitiveAnalysisSuccessResponse {
  success: true;
  company: string;
  ticker: string | null;
  industry: string;
  forces: ForcesObject;
  overall_assessment: string;
  research_grounded: boolean;
  disclaimer?: string;
  disclaimer_en?: string;
  _sources?: SourceCitation[];
  _meta: ResponseMeta;
}

export interface CompetitiveAnalysisErrorResponse {
  success: false;
  error: string;
  code: ErrorCode;
  _meta?: Partial<ResponseMeta> & Record<string, unknown>;
}
