// Plan runner: the single place that EXECUTES a RequestPlan.
//
// - HTTP plans go through http/createRequestJson — so every strategy-driven
//   upstream call gets retry + per-host circuit breaker + structured wire
//   logging for free (the same hardened transport the rest of the app uses).
// - Local plans resolve their value (or thunk) directly — for synthetic sources
//   (e.g. GENERAL) or for wrapping an existing service function that already
//   does its own multi-step fetching/merging.
//
// fetch is resolved at call time so test stubs (vi.stubGlobal("fetch", …)) are
// honored. Builders supply the policy (see strategy/common.ts presets + the
// per-source SOURCE_TIMEOUT_MS); the runner only fills a default timeout when a
// plan omitted one.

import { createRequestJson, type RequestPolicy } from "../http/httpClient";
import type { RequestPlan } from "./types";

const DEFAULT_TIMEOUT_MS = 30_000;

const strategyRequestJson = createRequestJson<string>({
  fetchFn: (input, init) => fetch(input, init),
});

export async function runPlan<T = unknown>(plan: RequestPlan<T>): Promise<T> {
  if (plan.type === "local") {
    const { value } = plan;
    return typeof value === "function"
      ? await (value as () => T | Promise<T>)()
      : value;
  }

  // HTTP: ensure a complete RequestPolicy (the plan's partial policy may omit
  // timeoutMs / maxRetries). source = endpointName drives the circuit key + logs.
  const policy: RequestPolicy = {
    maxRetries: 0,
    ...plan.policy,
    timeoutMs: plan.policy?.timeoutMs ?? DEFAULT_TIMEOUT_MS,
  };
  return strategyRequestJson<T>({
    source: plan.request.endpointName,
    request: plan.request,
    policy,
  });
}
