// Business orchestration: research → analysis → response.
// Wire-format assembly lives in envelope.ts so this file stays focused
// on the pipeline.

import { CompetitiveError } from "./errors";
import { buildResearchTelemetry, buildSuccessResponse } from "./envelope";
import { logger } from "./logger";
import { runAnalysisPipeline, runResearchPipeline } from "./strategy";
import { elapsedMs, nowNs } from "./timing";
import type {
  CompetitiveAnalysisRequest,
  CompetitiveAnalysisSuccessResponse,
} from "./types/wire";

// Orchestrates research → analysis. Input is already zod-validated by
// the handler (so companyName OR ticker is guaranteed).
//
// - Research failures degrade to grounded=false + disclaimer (handled by
//   envelope.ts via the StampedResearch outcome status).
// - Analysis failures throw — wrapped with research telemetry context
//   so the handler can surface partial state in the error response.
export async function runCompetitiveAnalysis(
  input: CompetitiveAnalysisRequest,
): Promise<CompetitiveAnalysisSuccessResponse> {
  const startTotal = nowNs();

  const ticker = input.ticker?.trim() || undefined;
  const companyName = (input.companyName?.trim() || ticker)!;

  logger.info(`\n${"=".repeat(50)}`);
  logger.info(`🏭 开始竞争分析: ${companyName}`);
  logger.info(`${"=".repeat(50)}`);

  const research = await runResearchPipeline({
    companyName,
    ticker,
    additionalContext: input.additionalContext,
  });

  let analysis;
  try {
    analysis = await runAnalysisPipeline({
      companyName,
      researchContext:
        research.outcome.status === "ok" ? research.outcome.content : "",
      additionalContext: input.additionalContext,
      lang: input.lang,
    });
  } catch (e) {
    // Preserve research telemetry on the error so handler can include it
    // in the error _meta — operators need to see WHERE the pipeline broke.
    if (e instanceof CompetitiveError) {
      throw new CompetitiveError(e.code, e.message, buildResearchTelemetry(research));
    }
    throw e;
  }

  const totalMs = elapsedMs(startTotal);
  logger.info(`\n${"=".repeat(50)}`);
  logger.info(`📊 竞争分析完成: ${companyName}  (总耗时 ${totalMs.toFixed(1)}ms)`);
  logger.info(`${"=".repeat(50)}\n`);

  return buildSuccessResponse({
    research,
    analysis,
    totalMs,
    ticker: ticker || null,
    companyNameFallback: companyName,
  });
}

/** Trim the COMPETITIVE (Porter's Five Forces) payload for the LLM prompt.
 *  Extracted verbatim from generator.simplifyApiData — no behavior change. */
export function simplifyCompetitive(data: any): any {
  const forces = data.en?.forces || data.forces || {};
  return {
    company: data.company,
    industry: data.industry,
    overall_assessment: (data.overall_assessment || data.forces?.overall_assessment)?.substring(0, 350),
    forces: {
      competitive_rivalry: { score: forces.competitive_rivalry?.score, summary: forces.competitive_rivalry?.analysis?.substring(0, 250) },
      threat_of_new_entrants: { score: forces.threat_of_new_entrants?.score, summary: forces.threat_of_new_entrants?.analysis?.substring(0, 250) },
      threat_of_substitutes: { score: forces.threat_of_substitutes?.score, summary: forces.threat_of_substitutes?.analysis?.substring(0, 250) },
      supplier_power: { score: forces.supplier_power?.score, summary: forces.supplier_power?.analysis?.substring(0, 250) },
      buyer_power: { score: forces.buyer_power?.score, summary: forces.buyer_power?.analysis?.substring(0, 250) },
    },
  };
}
