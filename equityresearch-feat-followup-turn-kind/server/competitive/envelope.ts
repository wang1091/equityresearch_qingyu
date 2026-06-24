// Wire-format response envelope assembly.
// Lives separate from service.ts so the business pipeline doesn't get
// tangled with the contract shape — changing _meta layout touches this
// file; changing the business flow touches service.ts.

import { CONTRACT_VERSION, PROVIDER_ID } from "./types/contract";
import type { CompetitiveAnalysisSuccessResponse } from "./types/wire";
import type {
  StampedAnalysis,
  StampedResearch,
} from "./providers/types";

const DISCLAIMER_ZH =
  "此分析未使用实时网络研究素材（Perplexity 调用失败或超时），仅基于 LLM 训练数据生成；可能与近期市场动态有偏差，对训练数据稀薄的标的（小盘股、近期 IPO、新兴公司）尤需谨慎核实。";
const DISCLAIMER_EN =
  "Analysis generated without real-time web research (Perplexity unavailable). Based on LLM training data only; may not reflect recent market events, especially for small caps, recent IPOs, or emerging companies.";

interface EnvelopeInput {
  research: StampedResearch;
  analysis: StampedAnalysis;
  totalMs: number;
  ticker: string | null;
  companyNameFallback: string;
}

export function buildSuccessResponse({
  research,
  analysis,
  totalMs,
  ticker,
  companyNameFallback,
}: EnvelopeInput): CompetitiveAnalysisSuccessResponse {
  const r = research.outcome;
  const a = analysis.outcome;

  // Grounded only if research succeeded AND surfaced citations. A refusal
  // text from Perplexity (content > 0 but sources = 0) should NOT count
  // as grounded — it would suppress the disclaimer and let the LLM
  // hallucinate against an apology.
  const researchGrounded = r.status === "ok" && r.sources.length > 0;

  return {
    success: true,
    company: a.company || companyNameFallback,
    ticker,
    industry: a.industry,
    forces: a.forces,
    overall_assessment: a.overall_assessment,
    research_grounded: researchGrounded,
    ...(researchGrounded
      ? {}
      : { disclaimer: DISCLAIMER_ZH, disclaimer_en: DISCLAIMER_EN }),
    ...(r.status === "ok" && r.sources.length > 0 ? { _sources: r.sources } : {}),
    _meta: {
      provider: PROVIDER_ID,
      // Always surface attempted provider for diagnostics, regardless
      // of grounded status (contract §10.3).
      research_provider: research.providerId,
      research_model: research.providerModel,
      analysis_model: analysis.providerModel,
      duration_ms: totalMs,
      step_timings: {
        research_ms: r.durationMs,
        analysis_ms: a.durationMs,
      },
      version: CONTRACT_VERSION,
      ...(r.status === "empty" ? { research_error_kind: r.errorKind } : {}),
    },
  };
}

// Partial meta to attach to a CompetitiveError when analysis fails AFTER
// research succeeded — handler merges this into the error response so
// operators can see WHERE the pipeline broke without diving into logs.
export function buildResearchTelemetry(research: StampedResearch): Record<string, unknown> {
  const r = research.outcome;
  return {
    research_provider: research.providerId,
    research_model: research.providerModel,
    research_ms: r.durationMs,
    research_grounded: r.status === "ok" && r.sources.length > 0,
    ...(r.status === "empty" ? { research_error_kind: r.errorKind } : {}),
    ...(r.status === "ok" && r.sources.length > 0
      ? { sources_count: r.sources.length }
      : {}),
  };
}
