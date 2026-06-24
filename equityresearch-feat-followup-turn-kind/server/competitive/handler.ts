import type { Request, Response } from "express";
import { getErrorMessage } from "../utils";
import { logger } from "./logger";
import { runCompetitiveAnalysis } from "./service";
import { getOrCompute } from "./cache";
import { CompetitiveError } from "./errors";
import { RequestSchema, summarizeZodIssues } from "./schemas";
import { elapsedMs, nowNs } from "./timing";
import {
  CompetitiveAnalysisErrorResponse,
  CONTRACT_VERSION,
  ErrorCode,
  PROVIDER_ID,
} from "./types";

// Maps ErrorCode → HTTP status. Aligned with COMPETITIVE_API_CONTRACT.md §5.1.
// Exhaustive switch — no default branch — so adding a new ErrorCode to
// types/contract.ts without updating this mapping is a TS compile error.
function statusForCode(code: ErrorCode): number {
  switch (code) {
    case "MISSING_COMPANY_NAME":
    case "INVALID_INPUT":
      return 400;
    case "UPSTREAM_PERPLEXITY_FAILED":
    case "UPSTREAM_LLM_FAILED":
      return 502;
    case "TIMEOUT":
      return 504;
    case "INTERNAL":
      return 500;
  }
  const exhaustive: never = code;
  throw new Error(`Unhandled ErrorCode in statusForCode: ${exhaustive}`);
}

function isTimeoutError(error: any): boolean {
  return (
    error?.name === "TimeoutError" ||
    error?.name === "AbortError" ||
    /timeout|aborted/i.test(error?.message || "")
  );
}

// Express handler for POST /api/competitive-analysis.
// Thin wrapper: delegates business logic to runCompetitiveAnalysis,
// only owns HTTP mapping + structured error response.
export async function handleCompetitiveAnalysis(
  req: Request,
  res: Response
): Promise<void> {
  const startTotal = nowNs();
  try {
    const body = (req.body ?? {}) as Record<string, unknown>;

    // Semantic precheck: identifies the "neither provided / both empty"
    // case BEFORE zod, so we always return MISSING_COMPANY_NAME for that
    // regardless of zod's internal issue ordering (refine vs min(1) can
    // surface in different order; fuzzy-matching the message text is
    // brittle). See reviewer C1.
    const companyNameValid =
      typeof body.companyName === "string" && body.companyName.trim().length > 0;
    const tickerValid =
      typeof body.ticker === "string" && body.ticker.trim().length > 0;
    if (!companyNameValid && !tickerValid) {
      throw new CompetitiveError(
        "MISSING_COMPANY_NAME",
        "Either companyName or ticker is required"
      );
    }

    // Field-level validation (length caps, lang enum, types, etc.)
    const reqValidation = RequestSchema.safeParse(body);
    if (!reqValidation.success) {
      throw new CompetitiveError(
        "INVALID_INPUT",
        summarizeZodIssues(reqValidation.error.issues)
      );
    }

    // Shared cache: the standalone /competitive page and the agent's node
    // provider both reach this endpoint, so a repeated ticker returns
    // instantly and identically within the TTL. Only successes are cached.
    const { result, cached, ageMs } = await getOrCompute(reqValidation.data, () =>
      runCompetitiveAnalysis(reqValidation.data),
    );
    // Clone (don't mutate the stored object) to stamp cache telemetry.
    res.json(
      cached
        ? { ...result, _meta: { ...result._meta, cached: true, cache_age_ms: ageMs } }
        : result,
    );
  } catch (error: any) {
    const totalTime = elapsedMs(startTotal);
    logger.error(`\n❌ 竞争分析失败 (耗时 ${totalTime.toFixed(1)}ms):`, error);

    const code: ErrorCode =
      error instanceof CompetitiveError
        ? error.code
        : isTimeoutError(error)
          ? "TIMEOUT"
          : "INTERNAL";

    // If service.ts re-threw a CompetitiveError with partial-state context
    // (e.g., research succeeded but analysis failed), surface it in _meta
    // so ops can see WHERE in the pipeline things broke without diving
    // into logs.
    const partialMeta =
      error instanceof CompetitiveError ? error.metaContext : undefined;

    const body: CompetitiveAnalysisErrorResponse = {
      success: false,
      error: getErrorMessage(error),
      code,
      _meta: {
        provider: PROVIDER_ID,
        duration_ms: totalTime,
        version: CONTRACT_VERSION,
        ...(partialMeta ?? {}),
      },
    };
    res.status(statusForCode(code)).json(body);
  }
}
