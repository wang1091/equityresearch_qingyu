import {
  createTraceId,
  getTraceContext,
} from "../observability/context";
import { logger } from "../observability/logger";
import { sanitizeHeadersForLog } from "../observability/logging";

export type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
const TRACED_FETCH_SYMBOL = Symbol.for("equityresearch.tracedFetch");

function toUrl(input: RequestInfo | URL): string {
  if (typeof input === "string") {
    return input;
  }
  if (input instanceof URL) {
    return input.toString();
  }
  return input.url;
}

function buildHeaders(input: RequestInfo | URL, init?: RequestInit): Headers {
  const headers = new Headers();

  if (typeof input !== "string" && !(input instanceof URL)) {
    const requestHeaders = new Headers(input.headers);
    requestHeaders.forEach((value, key) => {
      headers.set(key, value);
    });
  }

  if (init?.headers) {
    const initHeaders = new Headers(init.headers);
    initHeaders.forEach((value, key) => {
      headers.set(key, value);
    });
  }

  return headers;
}

export function createTracedFetch(fetchFn: FetchLike): FetchLike {
  const existing = fetchFn as FetchLike & { [TRACED_FETCH_SYMBOL]?: boolean };
  if (existing[TRACED_FETCH_SYMBOL]) {
    return fetchFn;
  }

  const wrapped: FetchLike & { [TRACED_FETCH_SYMBOL]?: boolean } = async (
    input: RequestInfo | URL,
    init?: RequestInit,
  ) => {
    const startedAt = Date.now();
    const trace = getTraceContext();
    const traceId = trace?.traceId || createTraceId();
    const method = init?.method ||
      (typeof input !== "string" && !(input instanceof URL) ? input.method : undefined) ||
      "GET";
    const url = toUrl(input);

    const headers = buildHeaders(input, init);
    if (!headers.has("x-trace-id")) {
      headers.set("x-trace-id", traceId);
    }

    logger.debug("http.downstream.start", {
      traceId,
      method,
      url,
      hasBody: Boolean(init?.body),
    });
    logger.wire({
      direction: "send",
      module: "observability.fetch.createTracedFetch",
      source: "HTTP_DOWNSTREAM",
      url,
      method,
      headers,
      payload: init?.body ?? null,
      extra: {
        traceId,
        hasBody: Boolean(init?.body),
        headerSummary: sanitizeHeadersForLog(headers),
      },
    });

    try {
      const response = await fetchFn(input, {
        ...init,
        headers,
      });

      logger.info("http.downstream.finish", {
        traceId,
        method,
        url,
        status: response.status,
        ok: response.ok,
        durationMs: Date.now() - startedAt,
      });
      logger.wire({
        direction: "recv",
        module: "observability.fetch.createTracedFetch",
        source: "HTTP_DOWNSTREAM",
        url,
        method,
        status: response.status,
        durationMs: Date.now() - startedAt,
        extra: {
          traceId,
          ok: response.ok,
          responseHeaders: sanitizeHeadersForLog(response.headers),
        },
      });

      return response;
    } catch (error) {
      logger.error("http.downstream.error", {
        traceId,
        method,
        url,
        durationMs: Date.now() - startedAt,
        error,
      });
      logger.wire(
        {
          direction: "recv",
          module: "observability.fetch.createTracedFetch",
          source: "HTTP_DOWNSTREAM",
          url,
          method,
          durationMs: Date.now() - startedAt,
          payload: error,
          extra: {
            traceId,
            outcome: "error",
          },
        },
        { level: "error", event: "wire.message.error", force: true },
      );
      throw error;
    }
  };

  wrapped[TRACED_FETCH_SYMBOL] = true;
  return wrapped;
}
