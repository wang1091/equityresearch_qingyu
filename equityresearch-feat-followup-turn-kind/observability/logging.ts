import { inspect } from "node:util";

export type WireDirection = "send" | "recv";

type JsonLike = string | number | boolean | null | JsonLike[] | { [key: string]: JsonLike };

export interface WireLogInput {
  direction: WireDirection;
  module: string;
  source?: string | null;
  url?: string | null;
  method?: string | null;
  status?: number | null;
  durationMs?: number | null;
  attempt?: number | null;
  payload?: unknown;
  headers?: HeadersInit | Headers | null;
  extra?: Record<string, unknown>;
}

export interface PayloadLogValue {
  payload: unknown;
  payloadLength: number;
  truncated: boolean;
  payloadPreview: string;
}

interface ErrorFrame {
  functionName: string | null;
  file: string;
  line: number;
  column: number;
}

const DEFAULT_LOG_PAYLOAD_MAX_CHARS = 20_000;
const DEFAULT_PREVIEW_MAX_CHARS = 1_600;
const MAX_REDACT_DEPTH = 8;
const REDACTED = "[REDACTED]";
const MAX_DEPTH_REPLACEMENT = "[MAX_DEPTH]";
const SENSITIVE_FIELD_NAMES = [
  "authorization",
  "api_key",
  "apikey",
  "x-api-key",
  "access_token",
  "refresh_token",
  "token",
  "password",
  "secret",
  "client_secret",
  "bearer",
] as const;
const SENSITIVE_FIELD_SET = new Set<string>(SENSITIVE_FIELD_NAMES);

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isSensitiveField(fieldName: string): boolean {
  const normalized = fieldName.trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (SENSITIVE_FIELD_SET.has(normalized)) {
    return true;
  }

  return normalized.endsWith("_authorization")
    || normalized.endsWith("_api_key")
    || normalized.endsWith("_secret")
    || normalized.endsWith("_password")
    || normalized.endsWith("_token");
}

function truncateText(text: string, maxChars: number): { text: string; truncated: boolean } {
  if (maxChars <= 0) {
    return { text: "", truncated: text.length > 0 };
  }

  if (text.length <= maxChars) {
    return { text, truncated: false };
  }

  return {
    text: `${text.slice(0, Math.max(0, maxChars - 15))}...[truncated]`,
    truncated: true,
  };
}

export function resolveLogPayloadMaxChars(): number {
  const raw = Number(process.env.LOG_PAYLOAD_MAX_CHARS);
  if (Number.isFinite(raw) && raw > 0) {
    return Math.trunc(raw);
  }
  return DEFAULT_LOG_PAYLOAD_MAX_CHARS;
}

export function isVerboseWireLoggingEnabled(): boolean {
  return process.env.LOG_VERBOSE_WIRE !== "false";
}

function normalizeForJson(value: unknown, depth: number): JsonLike {
  if (depth > MAX_REDACT_DEPTH) {
    return MAX_DEPTH_REPLACEMENT;
  }

  if (value === null || value === undefined) {
    return null;
  }

  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return value;
  }

  if (typeof value === "bigint") {
    return String(value);
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (value instanceof Error) {
    return {
      name: value.name,
      message: value.message,
      stack: value.stack || null,
    };
  }

  if (Array.isArray(value)) {
    return value.map((item) => normalizeForJson(item, depth + 1));
  }

  if (isRecord(value)) {
    const output: Record<string, JsonLike> = {};
    for (const [key, entry] of Object.entries(value)) {
      if (isSensitiveField(key)) {
        output[key] = REDACTED;
      } else {
        output[key] = normalizeForJson(entry, depth + 1);
      }
    }
    return output;
  }

  return inspect(value, { depth: 2, breakLength: 120 });
}

export function sanitizeHeadersForLog(headers: HeadersInit | Headers | null | undefined): Record<string, string> {
  if (!headers) {
    return {};
  }

  const normalized: Record<string, string> = {};
  const assign = (key: string, value: string) => {
    normalized[key.toLowerCase()] = isSensitiveField(key) ? REDACTED : value;
  };

  if (headers instanceof Headers) {
    headers.forEach((value, key) => assign(key, value));
    return normalized;
  }

  if (Array.isArray(headers)) {
    for (const [key, value] of headers) {
      assign(key, value);
    }
    return normalized;
  }

  for (const [key, value] of Object.entries(headers)) {
    if (Array.isArray(value)) {
      assign(key, value.join(", "));
    } else if (typeof value === "string") {
      assign(key, value);
    } else if (typeof value === "number" || typeof value === "boolean") {
      assign(key, String(value));
    }
  }

  return normalized;
}

function stringifyNormalized(value: JsonLike): string {
  if (typeof value === "string") {
    return value;
  }

  try {
    return JSON.stringify(value);
  } catch {
    return inspect(value, { depth: 4, breakLength: 120 });
  }
}

export function toPayloadLogValue(value: unknown): PayloadLogValue {
  if (value === undefined || value === null) {
    return {
      payload: null,
      payloadLength: 0,
      truncated: false,
      payloadPreview: "",
    };
  }

  const normalized = normalizeForJson(value, 0);
  const serialized = stringifyNormalized(normalized);
  const payloadLength = serialized.length;
  const maxChars = resolveLogPayloadMaxChars();
  const maybeTruncated = truncateText(serialized, maxChars);
  const preview = truncateText(maybeTruncated.text, DEFAULT_PREVIEW_MAX_CHARS).text;

  if (maybeTruncated.truncated) {
    return {
      payload: maybeTruncated.text,
      payloadLength,
      truncated: true,
      payloadPreview: preview,
    };
  }

  return {
    payload: normalized,
    payloadLength,
    truncated: false,
    payloadPreview: preview,
  };
}

export function buildWireLogData(input: WireLogInput): Record<string, unknown> {
  const payloadLog = toPayloadLogValue(input.payload);
  const data: Record<string, unknown> = {
    direction: input.direction,
    module: input.module,
    source: input.source ?? null,
    url: input.url ?? null,
    method: input.method ?? null,
    status: typeof input.status === "number" ? input.status : null,
    durationMs: typeof input.durationMs === "number" ? input.durationMs : null,
    attempt: typeof input.attempt === "number" ? input.attempt : null,
    payload: payloadLog.payload,
    payloadLength: payloadLog.payloadLength,
    truncated: payloadLog.truncated,
    payloadPreview: payloadLog.payloadPreview,
  };

  if (input.headers) {
    const safeHeaders = sanitizeHeadersForLog(input.headers);
    data.headers = safeHeaders;
    data.headerCount = Object.keys(safeHeaders).length;
  }

  if (input.extra && typeof input.extra === "object") {
    Object.assign(data, normalizeForJson(input.extra, 0));
  }

  return data;
}

function parseStackFrame(line: string): ErrorFrame | null {
  const match = line.match(/^\s*at\s+(?:(.+?)\s+\()?(.+):(\d+):(\d+)\)?$/);
  if (!match) {
    return null;
  }

  const [, fnNameRaw, fileRaw, lineRaw, columnRaw] = match;
  const file = String(fileRaw || "").trim();
  const lowerFile = file.toLowerCase();

  if (!file || lowerFile.startsWith("node:internal") || lowerFile.includes("/node_modules/")) {
    return null;
  }

  return {
    functionName: fnNameRaw ? fnNameRaw.trim() : null,
    file,
    line: Number(lineRaw),
    column: Number(columnRaw),
  };
}

function extractBestErrorFrame(stack: string | undefined): ErrorFrame | null {
  if (!stack) {
    return null;
  }

  const lines = stack.split("\n");
  const frames = lines
    .map((line) => parseStackFrame(line))
    .filter((frame): frame is ErrorFrame => Boolean(frame));

  if (frames.length === 0) {
    return null;
  }

  const cwd = process.cwd();
  const internalCandidate = frames.find((frame) => frame.file.startsWith(cwd));
  return internalCandidate || frames[0];
}

export function serializeErrorForLog(error: unknown): Record<string, unknown> {
  if (error instanceof Error) {
    const frame = extractBestErrorFrame(error.stack);
    const errorWithMeta = error as Error & {
      code?: unknown;
      httpStatus?: unknown;
      details?: unknown;
      cause?: unknown;
    };

    return {
      name: error.name,
      message: error.message,
      code: errorWithMeta.code ?? null,
      httpStatus: typeof errorWithMeta.httpStatus === "number" ? errorWithMeta.httpStatus : null,
      file: frame?.file ?? null,
      function: frame?.functionName ?? null,
      line: frame?.line ?? null,
      column: frame?.column ?? null,
      stack: error.stack || null,
      details: errorWithMeta.details !== undefined ? normalizeForJson(errorWithMeta.details, 0) : null,
      cause: errorWithMeta.cause !== undefined ? normalizeForJson(errorWithMeta.cause, 0) : null,
    };
  }

  if (isRecord(error)) {
    const normalized = normalizeForJson(error, 0);
    const message = typeof error.message === "string" ? error.message : inspect(normalized, { depth: 2 });
    return {
      name: "NonErrorObject",
      message,
      file: null,
      function: null,
      line: null,
      column: null,
      stack: null,
      details: normalized,
    };
  }

  return {
    name: typeof error,
    message: typeof error === "string" ? error : String(error),
    file: null,
    function: null,
    line: null,
    column: null,
    stack: null,
    details: null,
  };
}
