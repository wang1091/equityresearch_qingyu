// Retry decorators for the two provider layers.
//
// Could be merged into one generic withRetry<I, R>(), but the retryability
// signal differs:
//   - Research: returns ResearchOutcome (status: "ok" | "empty"); retry on
//     specific empty.errorKind values.
//   - Analysis: throws CompetitiveError; retry on specific error codes.
// Keep them as two specialized decorators that wrap Provider<I, R>.

import { CompetitiveError } from "../errors";
import { logger } from "../logger";
import type { ErrorCode } from "../types/contract";
import type {
  AnalysisInput,
  AnalysisOutcome,
  AnalysisProvider,
  ResearchErrorKind,
  ResearchInput,
  ResearchOutcome,
  ResearchProvider,
} from "./types";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ─────────────────────────────────────────────
// Research retry
// ─────────────────────────────────────────────

interface ResearchRetryOptions {
  maxRetries?: number;
  delayMs?: number;
  retryableKinds?: ResearchErrorKind[];
}

const DEFAULT_RETRYABLE_RESEARCH_KINDS: ResearchErrorKind[] = [
  "timeout",
  "server",
  "transport",
];

export function withResearchRetry(
  provider: ResearchProvider,
  opts: ResearchRetryOptions = {},
): ResearchProvider {
  const maxRetries = opts.maxRetries ?? 1;
  const delayMs = opts.delayMs ?? 1000;
  const retryable = opts.retryableKinds ?? DEFAULT_RETRYABLE_RESEARCH_KINDS;

  return {
    id: provider.id,
    model: provider.model,
    canHandle: provider.canHandle?.bind(provider),
    async perform(input: ResearchInput): Promise<ResearchOutcome> {
      let last: ResearchOutcome = {
        status: "empty",
        errorKind: "unknown",
        durationMs: 0,
      };
      for (let attempt = 0; attempt <= maxRetries; attempt++) {
        last = await provider.perform(input);
        if (last.status === "ok") return last;
        // Permanent error: give up immediately
        if (!retryable.includes(last.errorKind)) return last;
        if (attempt < maxRetries) {
          logger.info(
            `🔁 Research "${provider.id}" 重试 ${attempt + 1}/${maxRetries}` +
              ` (errorKind=${last.errorKind}, delay=${delayMs}ms)`,
          );
          await sleep(delayMs);
        }
      }
      return last;
    },
  };
}

// ─────────────────────────────────────────────
// Analysis retry
// ─────────────────────────────────────────────

interface AnalysisRetryOptions {
  maxRetries?: number;
  delayMs?: number;
  retryableCodes?: ErrorCode[];
}

const DEFAULT_RETRYABLE_ANALYSIS_CODES: ErrorCode[] = [
  "UPSTREAM_LLM_FAILED",
  "TIMEOUT",
];

export function withAnalysisRetry(
  provider: AnalysisProvider,
  opts: AnalysisRetryOptions = {},
): AnalysisProvider {
  const maxRetries = opts.maxRetries ?? 1;
  const delayMs = opts.delayMs ?? 1000;
  const retryable = opts.retryableCodes ?? DEFAULT_RETRYABLE_ANALYSIS_CODES;

  return {
    id: provider.id,
    model: provider.model,
    canHandle: provider.canHandle?.bind(provider),
    async perform(input: AnalysisInput): Promise<AnalysisOutcome> {
      let lastErr: unknown;
      for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
          return await provider.perform(input);
        } catch (e) {
          lastErr = e;
          // Non-CompetitiveError = programmer bug. Don't retry — fail fast.
          if (!(e instanceof CompetitiveError)) {
            throw e;
          }
          if (!retryable.includes(e.code)) {
            throw e;
          }
          if (attempt < maxRetries) {
            logger.info(
              `🔁 Analysis "${provider.id}" 重试 ${attempt + 1}/${maxRetries}` +
                ` (code=${e.code}, delay=${delayMs}ms)`,
            );
            await sleep(delayMs);
          }
        }
      }
      throw lastErr;
    },
  };
}
