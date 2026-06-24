// Wire-format types for the /api/competitive-analysis contract.
// Kept local for now; migrate to `shared/competitive.ts` when the server-side
// type module is extracted for cross-boundary reuse.

export type Lang = "en" | "zh";

export type Force = {
  score: number;
  analysis: string;
};

export type ForcesObject = {
  competitive_rivalry: Force;
  threat_of_new_entrants: Force;
  threat_of_substitutes: Force;
  supplier_power: Force;
  buyer_power: Force;
};

export type ForceKey = keyof ForcesObject;

export type SourceCitation = {
  url: string;
  title?: string;
  date?: string;
};

export type SuccessResponse = {
  success: true;
  company: string;
  ticker: string | null;
  industry: string;
  forces: ForcesObject;
  overall_assessment: string;
  research_grounded: boolean;
  disclaimer?: string;
  disclaimer_en?: string;
  zh?: {
    industry?: string;
    forces?: ForcesObject;
    overall_assessment?: string;
  };
  _sources?: SourceCitation[];
  _meta?: Record<string, unknown>;
};

export type ErrorResponse = {
  success: false;
  error: string;
  code?: string;
};

export type ApiResponse = SuccessResponse | ErrorResponse;

// Display order — radar axes and force cards follow this sequence.
export const FORCE_KEYS: readonly ForceKey[] = [
  "competitive_rivalry",
  "threat_of_new_entrants",
  "threat_of_substitutes",
  "supplier_power",
  "buyer_power",
] as const;
