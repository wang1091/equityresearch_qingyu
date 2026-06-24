import type {
  HttpRequestPlan,
  LocalRequestPlan,
  RequestConfig,
  RequestPolicy,
} from "./types";
import { SOURCE_TIMEOUT_MS } from "../shared/sourceCatalog";

export const JSON_HEADERS = { "Content-Type": "application/json" };

export type StrategyPolicy = Omit<RequestPolicy, "timeoutMs">;

export const BASE_POLICY: StrategyPolicy = {
  maxRetries: 2,
  retryDelayMs: 300,
  circuitBreaker: false,
  circuitFailureThreshold: 3,
  circuitOpenMs: 30_000,
};

export const HIGH_RISK_POLICY: StrategyPolicy = {
  ...BASE_POLICY,
  circuitBreaker: true,
};

export const PERFORMANCE_POLICY: StrategyPolicy = {
  ...HIGH_RISK_POLICY,
  maxRetries: 1,
  semaphoreKey: "PERFORMANCE",
  semaphoreLimit: 2,
};

export const PERFORMANCE_METRICS_POLICY: RequestPolicy = {
  timeoutMs: 30_000,
  ...PERFORMANCE_POLICY,
};

export const STRATEGY_TIMEOUT_MS = SOURCE_TIMEOUT_MS;

export function createJsonPostRequest(
  url: string,
  endpointName: string,
  body: unknown,
): RequestConfig {
  return {
    url,
    endpointName,
    init: {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify(body),
    },
  };
}

export function createHttpPlan(
  request: RequestConfig,
  policy: StrategyPolicy,
): HttpRequestPlan {
  return {
    type: "http",
    request,
    policy: { ...policy },
  };
}

export function createJsonPostPlan(
  url: string,
  endpointName: string,
  body: unknown,
  policy: StrategyPolicy,
): HttpRequestPlan {
  return createHttpPlan(createJsonPostRequest(url, endpointName, body), policy);
}

export function createLocalPlan<T>(
  value: T | (() => T | Promise<T>),
): LocalRequestPlan<T> {
  return {
    type: "local",
    value,
  };
}
