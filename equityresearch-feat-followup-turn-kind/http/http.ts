import { logger } from "../observability/logger";
import { createTracedFetch } from "./fetch";
import { createAbortError, createAbortScope, isAbortError } from "./abort";

export type FetchFn = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export interface JsonUpstreamResponse {
  status: number;
  text: string;
  payload: unknown | null;
}

export function parseJsonTextSafe(text: string): unknown | null {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

interface JsonPostRequest {
  url: string;
  body: unknown;
  fetchFn: FetchFn;
  timeoutMs?: number;
  signal?: AbortSignal;
  source?: string;
  endpointName?: string;
  module?: string;
}

export async function postJsonUpstream({
  url,
  body,
  fetchFn,
  timeoutMs,
  signal,
  source,
  endpointName,
  module,
}: JsonPostRequest): Promise<JsonUpstreamResponse> {
  const startedAt = Date.now();
  const tracedFetch = createTracedFetch(fetchFn);
  const init: RequestInit = {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  };

  const abortScope = createAbortScope({
    externalSignal: signal,
    externalReason: "unknown_abort",
    timeoutMs,
    timeoutReason: "upstream_timeout",
  });

  try {
    logger.wire({
      direction: "send",
      module: module || "execution.http.postJsonUpstream",
      source: source || endpointName || "UPSTREAM_JSON",
      url,
      method: "POST",
      payload: body,
      headers: init.headers ?? null,
      extra: {
        timeoutMs: timeoutMs ?? null,
        endpointName: endpointName ?? null,
      },
    });
    init.signal = abortScope.signal;
    const response = await tracedFetch(url, init);
    const text = await response.text();
    const payload = parseJsonTextSafe(text);
    logger.wire({
      direction: "recv",
      module: module || "execution.http.postJsonUpstream",
      source: source || endpointName || "UPSTREAM_JSON",
      url,
      method: "POST",
      status: response.status,
      durationMs: Date.now() - startedAt,
      payload: text,
      headers: response.headers,
      extra: {
        endpointName: endpointName ?? null,
        parseOk: payload !== null,
      },
    });

    return {
      status: response.status,
      text,
      payload,
    };
  } catch (error) {
    logger.wire(
      {
        direction: "recv",
        module: module || "execution.http.postJsonUpstream",
        source: source || endpointName || "UPSTREAM_JSON",
        url,
        method: "POST",
        durationMs: Date.now() - startedAt,
        payload: error,
        extra: {
          endpointName: endpointName ?? null,
          outcome: "error",
        },
      },
      { level: "error", event: "wire.message.error", force: true },
    );
    const reason = abortScope.getCancellationReason();
    if (isAbortError(error) && reason) {
      throw createAbortError(reason);
    }
    throw error;
  } finally {
    abortScope.cleanup();
  }
}
