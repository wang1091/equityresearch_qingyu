import { logger } from "../observability/logger";
import { createTracedFetch } from "./fetch";
import {
  createAbortScope,
  createAbortError,
  isAbortError,
  sleepWithSignal,
  throwIfAborted,
} from "./abort";

export type ApiErrorCode =
  | "VALIDATION_ERROR"
  | "HTTP_ERROR"
  | "TIMEOUT"
  | "CIRCUIT_OPEN"
  | "PARSE_ERROR"
  | "NETWORK_ERROR"
  | "UNKNOWN_DATA_SOURCE"
  | "STRATEGY_ERROR"
  | "UNKNOWN_ERROR";

export interface ApiFailure {
  errorCode: ApiErrorCode;
  message: string;
  source: string;
  status?: number;
  retryable?: boolean;
  endpoint?: string;
}

interface ErrorMeta<Source extends string> {
  code: ApiErrorCode;
  source: Source;
  endpoint?: string;
  status?: number;
  retryable: boolean;
}

export class ApiRequestError<Source extends string = string> extends Error {
  readonly code: ApiErrorCode;
  readonly source: Source;
  readonly endpoint?: string;
  readonly status?: number;
  readonly retryable: boolean;

  constructor(message: string, meta: ErrorMeta<Source>) {
    super(message);
    this.name = "ApiRequestError";
    this.code = meta.code;
    this.source = meta.source;
    this.endpoint = meta.endpoint;
    this.status = meta.status;
    this.retryable = meta.retryable;
  }
}

export class RetryableError<Source extends string = string> extends ApiRequestError<Source> {
  constructor(message: string, meta: Omit<ErrorMeta<Source>, "retryable">) {
    super(message, { ...meta, retryable: true });
    this.name = "RetryableError";
  }
}

export class NonRetryableError<Source extends string = string> extends ApiRequestError<Source> {
  constructor(message: string, meta: Omit<ErrorMeta<Source>, "retryable">) {
    super(message, { ...meta, retryable: false });
    this.name = "NonRetryableError";
  }
}

interface CircuitState {
  failures: number;
  openUntil: number;
}

interface SemaphoreState {
  active: number;
  queue: Array<() => void>;
}

export interface RequestPolicy {
  timeoutMs: number;
  maxRetries: number;
  retryDelayMs?: number;
  circuitBreaker?: boolean;
  circuitFailureThreshold?: number;
  circuitOpenMs?: number;
  semaphoreKey?: string;
  semaphoreLimit?: number;
}

export interface RequestConfig {
  url: string;
  endpointName: string;
  init?: RequestInit;
}

export interface RequestPostProcessContext<Source extends string> {
  source: Source;
  endpointName: string;
  url: string;
  status: number;
  headers: Headers;
}

export interface RequestJsonOptions<Source extends string, T = unknown> {
  source: Source;
  request: RequestConfig;
  policy: RequestPolicy;
  postProcess?: (raw: unknown, context: RequestPostProcessContext<Source>) => T;
}

export interface RequestJsonFn<Source extends string = string> {
  <T = unknown>(options: RequestJsonOptions<Source, T>): Promise<T>;
}

type FetchLike = typeof fetch;

interface CreateRequestJsonOptions {
  fetchFn: FetchLike;
}

const circuitStates = new Map<string, CircuitState>();
const semaphores = new Map<string, SemaphoreState>();

function withPolicyDefaults(policy: RequestPolicy): Required<RequestPolicy> {
  return {
    timeoutMs: policy.timeoutMs,
    maxRetries: policy.maxRetries,
    retryDelayMs: policy.retryDelayMs ?? 300,
    circuitBreaker: policy.circuitBreaker ?? false,
    circuitFailureThreshold: policy.circuitFailureThreshold ?? 3,
    circuitOpenMs: policy.circuitOpenMs ?? 30_000,
    semaphoreKey: policy.semaphoreKey ?? "",
    semaphoreLimit: policy.semaphoreLimit ?? 0,
  };
}

function buildCircuitKey(source: string, url: string, endpointName: string): string {
  try {
    const host = new URL(url).host;
    return `${source}:${host}`;
  } catch {
    return `${source}:${endpointName}`;
  }
}

function isCircuitOpen(key: string): boolean {
  const state = circuitStates.get(key);
  if (!state) {
    return false;
  }

  if (Date.now() >= state.openUntil) {
    circuitStates.set(key, { failures: state.failures, openUntil: 0 });
    return false;
  }

  return true;
}

function markCircuitSuccess(key: string): void {
  circuitStates.set(key, { failures: 0, openUntil: 0 });
}

function markCircuitFailure(key: string, threshold: number, openMs: number): void {
  const existing = circuitStates.get(key) ?? { failures: 0, openUntil: 0 };
  const nextFailures = existing.failures + 1;

  if (nextFailures >= threshold) {
    circuitStates.set(key, {
      failures: 0,
      openUntil: Date.now() + openMs,
    });
    return;
  }

  circuitStates.set(key, {
    failures: nextFailures,
    openUntil: 0,
  });
}

function toSnippet(text: string): string {
  return text.trim().slice(0, 220);
}

function extractErrorMessage(payload: unknown): string | undefined {
  if (payload && typeof payload === "object") {
    const candidate = payload as Record<string, unknown>;
    if (typeof candidate.error === "string") {
      return candidate.error;
    }
    if (typeof candidate.message === "string") {
      return candidate.message;
    }
  }
  return undefined;
}

async function fetchWithTimeout(
  fetchFn: FetchLike,
  url: string,
  init: RequestInit | undefined,
  timeoutMs: number,
  source: string,
  endpointName: string,
): Promise<Response> {
  const callerSignal = init?.signal ?? undefined;
  const abortScope = createAbortScope({
    externalSignal: callerSignal,
    externalReason: "unknown_abort",
    timeoutMs,
    timeoutReason: "upstream_timeout",
  });

  try {
    throwIfAborted(abortScope.signal);
    return await fetchFn(url, {
      ...init,
      signal: abortScope.signal,
    });
  } catch (error) {
    if (abortScope.getCancellationReason() === "upstream_timeout") {
      throw new RetryableError(`Request timed out after ${timeoutMs}ms`, {
        code: "TIMEOUT",
        source,
        endpoint: endpointName,
      });
    }

    if (isAbortError(error)) {
      throw error;
    }

    if (error instanceof ApiRequestError) {
      throw error;
    }

    const message = error instanceof Error ? error.message : "Network request failed";
    throw new RetryableError(message, {
      code: "NETWORK_ERROR",
      source,
      endpoint: endpointName,
    });
  } finally {
    abortScope.cleanup();
  }
}

async function parseResponseBody(
  response: Response,
  source: string,
  endpointName: string,
  url: string,
  method: string,
  attempt: number,
  startedAt: number,
): Promise<unknown> {
  const contentType = (response.headers.get("content-type") || "").toLowerCase();
  const bodyText = await response.text();
  logger.wire({
    direction: "recv",
    module: "shared.httpClient.parseResponseBody",
    source,
    url,
    method,
    status: response.status,
    durationMs: Date.now() - startedAt,
    attempt,
    payload: bodyText,
    headers: response.headers,
    extra: {
      endpointName,
      contentType,
      ok: response.ok,
    },
  });

  if (!response.ok) {
    let details = "";

    if (bodyText.trim().length > 0) {
      try {
        const parsed = JSON.parse(bodyText);
        details = extractErrorMessage(parsed) || toSnippet(bodyText);
      } catch {
        details = toSnippet(bodyText);
      }
    }

    const message = `HTTP ${response.status}${details ? ` - ${details}` : ""}`;
    const retryable = response.status === 429 || response.status >= 500;

    if (retryable) {
      throw new RetryableError(message, {
        code: "HTTP_ERROR",
        status: response.status,
        source,
        endpoint: endpointName,
      });
    }

    throw new NonRetryableError(message, {
      code: "HTTP_ERROR",
      status: response.status,
      source,
      endpoint: endpointName,
    });
  }

  if (bodyText.trim().length === 0) {
    return null;
  }

  if (contentType.includes("application/json")) {
    try {
      return JSON.parse(bodyText);
    } catch {
      throw new NonRetryableError(
        `Expected JSON but received invalid payload: ${toSnippet(bodyText)}`,
        {
          code: "PARSE_ERROR",
          source,
          endpoint: endpointName,
        },
      );
    }
  }

  try {
    const parsed = JSON.parse(bodyText);
    logger.warn(
      `${source}(${endpointName}) returned non-JSON content-type but JSON body was recovered`,
    );
    return parsed;
  } catch {
    throw new NonRetryableError(
      `Unexpected content-type (${contentType || "unknown"}) with non-JSON body: ${toSnippet(bodyText)}`,
      {
        code: "PARSE_ERROR",
        source,
        endpoint: endpointName,
      },
    );
  }
}

function ensureApiRequestError(
  error: unknown,
  source: string,
  endpointName: string,
): ApiRequestError {
  if (error instanceof ApiRequestError) {
    return error;
  }

  const message = error instanceof Error ? error.message : "Unknown request error";
  return new NonRetryableError(message, {
    code: "UNKNOWN_ERROR",
    source,
    endpoint: endpointName,
  });
}

async function executeWithRetry<Source extends string>(
  options: RequestJsonOptions<Source>,
  policy: Required<RequestPolicy>,
  fetchFn: FetchLike,
): Promise<unknown> {
  const { source, request } = options;
  const maxAttempts = policy.maxRetries + 1;

  let attempt = 0;
  while (attempt <= policy.maxRetries) {
    const attemptNumber = attempt + 1;
    const attemptStartedAt = Date.now();
    try {
      throwIfAborted(request.init?.signal ?? undefined);
      logger.wire({
        direction: "send",
        module: "shared.httpClient.executeWithRetry",
        source,
        url: request.url,
        method: request.init?.method || "GET",
        attempt: attemptNumber,
        payload: request.init?.body ?? null,
        headers: request.init?.headers ?? null,
        extra: {
          endpointName: request.endpointName,
          maxAttempts,
          timeoutMs: policy.timeoutMs,
        },
      });
      const response = await fetchWithTimeout(
        fetchFn,
        request.url,
        request.init,
        policy.timeoutMs,
        source,
        request.endpointName,
      );

      const parsed = await parseResponseBody(
        response,
        source,
        request.endpointName,
        request.url,
        request.init?.method || "GET",
        attemptNumber,
        attemptStartedAt,
      );
      logger.info("api.request.success", {
        source,
        endpoint: request.endpointName,
        url: request.url,
        attempt: attemptNumber,
        durationMs: Date.now() - attemptStartedAt,
      });
      return parsed;
    } catch (error) {
      if (isAbortError(error)) {
        throw error;
      }

      const normalized = ensureApiRequestError(error, source, request.endpointName);
      const retryContext = {
        source,
        endpoint: request.endpointName,
        url: request.url,
        attempt: attemptNumber,
        max_attempts: maxAttempts,
        error_code: normalized.code,
        status: normalized.status,
        retryable: normalized.retryable,
        message: normalized.message,
      };

      if (!normalized.retryable || attempt >= policy.maxRetries) {
        logger.error("api.request.failed", retryContext);
        logger.wire(
          {
            direction: "recv",
            module: "shared.httpClient.executeWithRetry",
            source,
            url: request.url,
            method: request.init?.method || "GET",
            status: normalized.status ?? null,
            durationMs: Date.now() - attemptStartedAt,
            attempt: attemptNumber,
            payload: error,
            extra: {
              endpointName: request.endpointName,
              outcome: "failed",
              errorCode: normalized.code,
              retryable: normalized.retryable,
            },
          },
          { level: "error", event: "wire.message.error", force: true },
        );
        throw normalized;
      }

      const backoff = policy.retryDelayMs * Math.pow(2, attempt);
      logger.warn("api.request.retry", {
        ...retryContext,
        next_backoff_ms: backoff,
      });
      logger.wire(
        {
          direction: "recv",
          module: "shared.httpClient.executeWithRetry",
          source,
          url: request.url,
          method: request.init?.method || "GET",
          status: normalized.status ?? null,
          durationMs: Date.now() - attemptStartedAt,
          attempt: attemptNumber,
          payload: error,
          extra: {
            endpointName: request.endpointName,
            outcome: "retry",
            errorCode: normalized.code,
            nextBackoffMs: backoff,
          },
        },
        { level: "warn", event: "wire.message.retry", force: true },
      );
      await sleepWithSignal(backoff, request.init?.signal ?? undefined);
      attempt += 1;
    }
  }

  throw new NonRetryableError("Retry loop exhausted", {
    code: "UNKNOWN_ERROR",
    source: options.source,
    endpoint: options.request.endpointName,
  });
}

async function acquireSemaphore(
  key: string,
  limit: number,
  signal?: AbortSignal,
): Promise<void> {
  if (!key || limit <= 0) {
    return;
  }

  throwIfAborted(signal);
  const state = semaphores.get(key) ?? { active: 0, queue: [] };
  semaphores.set(key, state);

  if (state.active < limit) {
    state.active += 1;
    return;
  }

  await new Promise<void>((resolve, reject) => {
    const grant = () => {
      cleanup();
      state.active += 1;
      resolve();
    };

    const onAbort = () => {
      const index = state.queue.indexOf(grant);
      if (index >= 0) {
        state.queue.splice(index, 1);
      }
      cleanup();
      reject(createAbortError(signal?.reason));
    };

    const cleanup = () => {
      signal?.removeEventListener("abort", onAbort);
    };

    state.queue.push(grant);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

function releaseSemaphore(key: string): void {
  if (!key) {
    return;
  }

  const state = semaphores.get(key);
  if (!state) {
    return;
  }

  state.active = Math.max(0, state.active - 1);
  const next = state.queue.shift();
  if (next) {
    next();
  }
}

export function createRequestJson<Source extends string>({
  fetchFn,
}: CreateRequestJsonOptions): RequestJsonFn<Source> {
  const tracedFetch = createTracedFetch(fetchFn);

  return async function requestJson<T = unknown>(
    options: RequestJsonOptions<Source, T>,
  ): Promise<T> {
    const policy = withPolicyDefaults(options.policy);
    const circuitKey = buildCircuitKey(
      options.source,
      options.request.url,
      options.request.endpointName,
    );

    if (policy.circuitBreaker && isCircuitOpen(circuitKey)) {
      logger.warn("api.request.circuit_open", {
        source: options.source,
        endpoint: options.request.endpointName,
        url: options.request.url,
      });
      throw new NonRetryableError(
        `Circuit is open for ${options.source} (${options.request.endpointName})`,
        {
          code: "CIRCUIT_OPEN",
          source: options.source,
          endpoint: options.request.endpointName,
        },
      );
    }

    await acquireSemaphore(
      policy.semaphoreKey,
      policy.semaphoreLimit,
      options.request.init?.signal ?? undefined,
    );

    try {
      const raw = await executeWithRetry(options, policy, tracedFetch);

      if (policy.circuitBreaker) {
        markCircuitSuccess(circuitKey);
      }

      return options.postProcess
        ? options.postProcess(raw, {
            source: options.source,
            endpointName: options.request.endpointName,
            url: options.request.url,
            status: 200,
            headers: new Headers(),
          })
        : (raw as T);
    } catch (error) {
      if (isAbortError(error)) {
        throw error;
      }

      const normalized = ensureApiRequestError(
        error,
        options.source,
        options.request.endpointName,
      );

      if (policy.circuitBreaker && normalized.code !== "CIRCUIT_OPEN") {
        markCircuitFailure(
          circuitKey,
          policy.circuitFailureThreshold,
          policy.circuitOpenMs,
        );
      }

      throw normalized;
    } finally {
      releaseSemaphore(policy.semaphoreKey);
    }
  };
}

export function toApiFailure(error: unknown, source: string, endpoint?: string): ApiFailure {
  if (error instanceof ApiRequestError) {
    return {
      errorCode: error.code,
      message: error.message,
      source: error.source,
      endpoint: error.endpoint,
      status: error.status,
      retryable: error.retryable,
    };
  }

  if (error instanceof Error) {
    return {
      errorCode: "UNKNOWN_ERROR",
      message: error.message,
      source,
      endpoint,
      retryable: false,
    };
  }

  return {
    errorCode: "UNKNOWN_ERROR",
    message: "Unknown error",
    source,
    endpoint,
    retryable: false,
  };
}

export function __resetHttpClientStateForTests(): void {
  circuitStates.clear();
  semaphores.clear();
}
