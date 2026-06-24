// Strategy / fallback-chain orchestration.
//
// Public surface: two pipeline functions. Each builds its provider chain
// internally and iterates them. The chain factory is no longer exposed
// because service.ts never inspects or modifies the chain — exposing it
// just forced callers to pass `input` twice.
//
// Runner returns a STAMPED result (provider attribution wrapped around
// the provider's outcome) — providers themselves return plain outcomes
// and the runner is the single place that adds id/model. No more
// in-place mutation of provider return values.

import { CompetitiveError } from "./errors";
import { logger } from "./logger";
import {
  analysisProviders,
  getAnalysisProvider,
  getResearchProvider,
  researchProviders,
} from "./providers/registry";
import type {
  AnalysisInput,
  AnalysisOutcome,
  ResearchInput,
  ResearchOutcome,
  StampedAnalysis,
  StampedResearch,
} from "./providers/types";

// ─────────────────────────────────────────────
// Chain step types — branded so a ResearchStep can't be passed where
// AnalysisStep is expected (TS structural typing would otherwise allow it).
// ─────────────────────────────────────────────

export interface ResearchStep {
  readonly _kind: "research";
  providerId: string;
}

export interface AnalysisStep {
  readonly _kind: "analysis";
  providerId: string;
}

// ─────────────────────────────────────────────
// Chain factories (private — pipeline is the public surface)
// ─────────────────────────────────────────────

function buildResearchChain(_input: ResearchInput): ResearchStep[] {
  // Today: single provider. Future: pick by input or env.
  return [{ _kind: "research", providerId: "perplexity" }];
}

function buildAnalysisChain(_input: AnalysisInput): AnalysisStep[] {
  return [{ _kind: "analysis", providerId: "deepseek" }];
}

// ─────────────────────────────────────────────
// Research pipeline
// ─────────────────────────────────────────────

interface ResearchPipelineOptions {
  chain?: ResearchStep[]; // override default chain (tests / feature flags)
}

// Runs the research chain. Returns the first stamped outcome with status
// "ok". If all return "empty", returns the LAST attempt's stamped result
// so the caller still sees durationMs / errorKind for telemetry.
export async function runResearchPipeline(
  input: ResearchInput,
  options?: ResearchPipelineOptions,
): Promise<StampedResearch> {
  const chain = options?.chain ?? buildResearchChain(input);

  // Sentinel for the "all providers skipped via canHandle" case.
  let last: StampedResearch = {
    outcome: { status: "empty", errorKind: "config", durationMs: 0 },
    providerId: "(none)",
    providerModel: "(none)",
  };

  for (const step of chain) {
    const provider = getResearchProvider(step.providerId);
    if (!provider) {
      throw new CompetitiveError(
        "INTERNAL",
        `Research provider not registered: ${step.providerId}. ` +
          `Known: ${Object.keys(researchProviders).join(", ")}`,
      );
    }
    if (provider.canHandle && !provider.canHandle(input)) {
      logger.info(`⏭️  Research provider "${provider.id}" 自路由跳过`);
      continue;
    }

    let outcome: ResearchOutcome;
    try {
      outcome = await provider.perform(input);
    } catch (e) {
      // Research providers are documented as "encode failure as outcome,
      // don't throw". If one DOES throw, that's a programmer bug — log
      // and treat as unknown error so the chain can move on.
      logger.error(`Research provider "${provider.id}" threw (should return empty outcome)`, {
        error: e instanceof Error ? e.message : String(e),
      });
      outcome = { status: "empty", errorKind: "unknown", durationMs: 0 };
    }

    last = {
      outcome,
      providerId: provider.id,
      providerModel: provider.model,
    };
    if (outcome.status === "ok") return last;
  }
  return last;
}

// ─────────────────────────────────────────────
// Analysis pipeline
// ─────────────────────────────────────────────

interface AnalysisPipelineOptions {
  chain?: AnalysisStep[];
}

// Runs the analysis chain. Returns the first stamped success.
// If all throw, re-throws the last error (preserving CompetitiveError.code).
// Non-retryable failures (INVALID_INPUT / INTERNAL / non-CompetitiveError)
// short-circuit immediately — they indicate request or local bugs that
// switching providers can't fix.
export async function runAnalysisPipeline(
  input: AnalysisInput,
  options?: AnalysisPipelineOptions,
): Promise<StampedAnalysis> {
  const chain = options?.chain ?? buildAnalysisChain(input);

  let lastError: unknown;
  let attempted = false;

  for (const step of chain) {
    const provider = getAnalysisProvider(step.providerId);
    if (!provider) {
      throw new CompetitiveError(
        "INTERNAL",
        `Analysis provider not registered: ${step.providerId}. ` +
          `Known: ${Object.keys(analysisProviders).join(", ")}`,
      );
    }
    if (provider.canHandle && !provider.canHandle(input)) {
      logger.info(`⏭️  Analysis provider "${provider.id}" 自路由跳过`);
      continue;
    }
    attempted = true;
    try {
      const outcome = await provider.perform(input);
      return {
        outcome,
        providerId: provider.id,
        providerModel: provider.model,
      };
    } catch (e) {
      lastError = e;
      const code = e instanceof CompetitiveError ? e.code : "non_competitive_error";
      logger.error(`Analysis provider "${provider.id}" failed`, {
        provider: provider.id,
        code,
        error: e instanceof Error ? e.message : String(e),
      });

      // Programmer bug — surface immediately, don't fallback.
      if (!(e instanceof CompetitiveError)) throw e;

      // Request / local config bug — can't be helped by another provider.
      if (
        e.code === "INVALID_INPUT" ||
        e.code === "INTERNAL" ||
        e.code === "MISSING_COMPANY_NAME"
      ) {
        throw e;
      }
      // Transient: fall through to next provider in the chain.
    }
  }

  if (!attempted) {
    throw new CompetitiveError(
      "INTERNAL",
      "No analysis provider in the chain can handle this input",
    );
  }
  throw lastError;
}
