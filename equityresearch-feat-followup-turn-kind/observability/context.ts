import { randomUUID } from "node:crypto";
import { AsyncLocalStorage } from "node:async_hooks";

export interface TraceContext {
  traceId: string;
  layer: string;
  parentLayer?: string;
  requestPath?: string;
  requestMethod?: string;
  userId?: string;
}

type HeaderMapLike = Record<string, string | string[] | undefined>;

const TRACE_HEADER_NAMES = ["x-trace-id", "x-request-id"] as const;
const traceStorage = new AsyncLocalStorage<TraceContext>();

function getHeaderValue(headers: HeaderMapLike, header: string): string | null {
  const raw = headers[header];
  if (typeof raw === "string" && raw.trim().length > 0) {
    return raw.trim();
  }

  if (Array.isArray(raw)) {
    const first = raw.find((item) => typeof item === "string" && item.trim().length > 0);
    return first ? first.trim() : null;
  }

  return null;
}

export function createTraceId(): string {
  return randomUUID();
}

export function resolveTraceIdFromHeaders(headers?: HeaderMapLike): string {
  if (!headers) {
    return createTraceId();
  }

  for (const header of TRACE_HEADER_NAMES) {
    const value = getHeaderValue(headers, header);
    if (value) {
      return value;
    }
  }

  return createTraceId();
}

export function ensureRequestTraceId(
  req: { headers?: HeaderMapLike },
  res?: { setHeader?: (name: string, value: string) => unknown },
): string {
  const traceId = resolveTraceIdFromHeaders(req.headers);
  if (res?.setHeader) {
    res.setHeader("x-trace-id", traceId);
  }
  return traceId;
}

export function deriveTraceContext(
  parent: TraceContext | undefined,
  layer: string,
): TraceContext {
  if (!parent) {
    const current = getTraceContext();
    if (current) {
      return {
        traceId: current.traceId,
        layer,
        parentLayer: current.layer,
        requestPath: current.requestPath,
        requestMethod: current.requestMethod,
        userId: current.userId,
      };
    }

    return {
      traceId: createTraceId(),
      layer,
    };
  }

  return {
    traceId: parent.traceId,
    layer,
    parentLayer: parent.layer,
    requestPath: parent.requestPath,
    requestMethod: parent.requestMethod,
    userId: parent.userId,
  };
}

export function runWithTraceContext<T>(
  context: TraceContext,
  run: () => T,
): T {
  return traceStorage.run(context, run);
}

export function getTraceContext(): TraceContext | undefined {
  return traceStorage.getStore();
}
