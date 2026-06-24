import { logger } from "./utils";
import { createRequestJson } from "../http/httpClient";

// Single shared client: every attempt routes through it, so each gets retry of
// transient errors, a per-host circuit breaker, a per-attempt timeout, and
// structured wire logging (observability/logger). The OUTER loop below keeps
// the cross-URL failover semantics this module has always had.
//
// fetchFn resolves the global fetch at call time (not capture time) so test
// stubs (vi.stubGlobal("fetch", ...)) are honored and we don't pin one binding.
const requestJson = createRequestJson<string>({
  fetchFn: (input, init) => fetch(input, init),
});

/** One upstream attempt: its URL, request init, and how to shape a 2xx body. */
export interface FallbackAttempt<T> {
  url: string;
  init: RequestInit;
  /** Shape the (already JSON-parsed) 2xx body; throw to reject this attempt and
   *  try the next one. Receives parsed JSON, NOT raw text. */
  parse: (raw: unknown) => T | Promise<T>;
  /** Per-attempt timeout override (else opts.timeoutMs). */
  timeoutMs?: number;
}

/** One failed attempt's diagnostics. `status`/`code` are present when the
 *  failure came from the HTTP transport (createRequestJson's ApiRequestError):
 *  `status` is the upstream HTTP status (e.g. 404), `code` the ApiErrorCode
 *  (e.g. "PARSE_ERROR", "NETWORK_ERROR"). Absent when `parse` threw a logical
 *  rejection. Callers use these to map total failure back to an HTTP response
 *  (e.g. pass an upstream 404 through, or 502 on invalid JSON). */
export interface UpstreamAttemptError {
  url: string;
  message: string;
  status?: number;
  code?: string;
}

/** Thrown when every attempt fails; carries each attempt's error for diagnostics. */
export class UpstreamFallbackError extends Error {
  constructor(message: string, readonly errors: UpstreamAttemptError[]) {
    super(message);
    this.name = "UpstreamFallbackError";
  }
}

export interface FetchJsonFallbackOptions {
  /** Default per-attempt timeout. */
  timeoutMs: number;
  /** Human label for logs (the caller's logLabel) — also the endpoint name. */
  label: string;
  /** Source tag used in error messages + circuit key, e.g. "VALUATION". */
  errorTag: string;
  /** Deprecated: body truncation is now handled by structured wire logging. */
  bodyLogLimit?: number;
  /** Transient-error retries per attempt (429/5xx/network/timeout). Default 1.
   *  NOTE: a timeout is retryable, so on a long-timeout endpoint a retry can ~2x
   *  the wait before failover — pass 0 there if that matters more than retries. */
  maxRetries?: number;
  /** Delay between retries (ms). Default 300. */
  retryDelayMs?: number;
  /** Trip a per-host circuit breaker after repeated failures. Default true. */
  circuitBreaker?: boolean;
  /** Consecutive failures before the circuit opens. Default 3. */
  circuitFailureThreshold?: number;
  /** How long the circuit stays open (ms). Default 30_000. */
  circuitOpenMs?: number;
}

/**
 * Sequential failover across a list of upstream attempts: try each in order,
 * return the first that is HTTP-ok AND shapes successfully; if all fail, throw
 * an UpstreamFallbackError carrying every attempt's error.
 *
 * This is FAILOVER, not retry — each attempt may target a different URL and
 * send a different body/parse (e.g. earnings: local `/query` → smartnews
 * `/ask` with a reshaped body). Throwing inside `parse` rejects that attempt
 * (so an HTTP-200 `{success:false}` or malformed body falls through to the
 * next attempt). NEWS/VALUATION are the degenerate case where every attempt
 * shares the same init/parse and only the base URL differs.
 *
 * Each attempt's transport now runs through http/createRequestJson, adding
 * retry + circuit breaker + wire logging WITHIN the attempt; `parse` runs
 * AFTER (outside retry) so a logical {success:false} rejection neither retries
 * nor trips the circuit (the HTTP call itself succeeded).
 *
 * NOTE: COMPETITIVE intentionally does NOT use this — its failover is domain-
 * level (only on `code: "UPSTREAM_LLM_FAILED"`, not on HTTP errors).
 */
export async function fetchJsonWithFallback<T>(
  attempts: FallbackAttempt<T>[],
  opts: FetchJsonFallbackOptions,
): Promise<T> {
  const { timeoutMs, label, errorTag } = opts;
  const policyBase = {
    maxRetries: opts.maxRetries ?? 1,
    retryDelayMs: opts.retryDelayMs ?? 300,
    circuitBreaker: opts.circuitBreaker ?? true,
    circuitFailureThreshold: opts.circuitFailureThreshold ?? 3,
    circuitOpenMs: opts.circuitOpenMs ?? 30_000,
  };
  const errors: UpstreamAttemptError[] = [];

  for (let i = 0; i < attempts.length; i++) {
    const attempt = attempts[i];
    const { url } = attempt;
    try {
      logger.info(`  → ${label} 请求上游: ${url}`);
      // Transport + retry + circuit + wire logging.
      const raw = await requestJson({
        source: errorTag,
        request: { url, endpointName: label, init: attempt.init },
        policy: { timeoutMs: attempt.timeoutMs ?? timeoutMs, ...policyBase },
      });
      // Shape OUTSIDE the retry/circuit path: a thrown `parse` is a logical
      // rejection (try next URL), not a transport failure.
      const shaped = await attempt.parse(raw);
      // This base succeeded only because an earlier one failed (e.g. local
      // primary down → public fallback) — make that recovery an explicit,
      // greppable event rather than something inferred from the logs above.
      if (i > 0) {
        logger.info("upstream.failover.recovered", {
          source: errorTag,
          label,
          url,
          afterFailures: i,
        });
      }
      return shaped;
    } catch (error) {
      const message = error instanceof Error ? error.message : `${errorTag} upstream failed`;
      // createRequestJson throws ApiRequestError with structured status/code;
      // a thrown `parse` is a plain Error (status/code stay undefined).
      const status = typeof (error as any)?.status === "number" ? (error as any).status : undefined;
      const code = typeof (error as any)?.code === "string" ? (error as any).code : undefined;
      logger.warn("upstream.attempt_failed", { source: errorTag, label, url, reason: message, status, code });
      errors.push({ url, message, status, code });
      // Explicit cross-URL failover transition (e.g. local primary → public
      // fallback), so the degrade is ONE structured line — not inferred from
      // two separate per-attempt request logs. Only when another base remains.
      if (i < attempts.length - 1) {
        logger.warn("upstream.failover", {
          source: errorTag,
          label,
          from: url,
          to: attempts[i + 1].url,
          reason: message,
          status,
          code,
        });
      }
    }
  }

  throw new UpstreamFallbackError(
    errors[errors.length - 1]?.message ?? `${errorTag} upstream failed`,
    errors,
  );
}
