import { getTraceContext } from "./context";
import { logSystem } from "./logSystem";
import {
  buildWireLogData,
  isVerboseWireLoggingEnabled,
  serializeErrorForLog,
  type WireLogInput,
} from "./logging";

export type LogLevel = "debug" | "info" | "warn" | "error";

interface LogRecord {
  timestamp: string;
  level: LogLevel;
  event: string;
  traceId?: string;
  userId?: string;
  layer?: string;
  parentLayer?: string;
  requestPath?: string;
  requestMethod?: string;
  data?: unknown;
}

const LOG_LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

const resolvedLogLevel = (): LogLevel => {
  const envLevel = (process.env.LOG_LEVEL || "").toLowerCase();
  if (envLevel === "debug" || envLevel === "info" || envLevel === "warn" || envLevel === "error") {
    return envLevel;
  }

  if (process.env.NODE_ENV === "development" || process.env.NODE_ENV === "test") {
    return "debug";
  }

  return "info";
};

const activeLogLevel = resolvedLogLevel();
const printToConsole = process.env.LOG_CONSOLE !== "false";
const consoleFormat = ((process.env.LOG_CONSOLE_FORMAT || "pretty").toLowerCase() === "json"
  ? "json"
  : "pretty") as "json" | "pretty";

function shouldLog(level: LogLevel): boolean {
  return LOG_LEVEL_PRIORITY[level] >= LOG_LEVEL_PRIORITY[activeLogLevel];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function asErrorData(value: unknown): unknown {
  if (value instanceof Error) {
    return serializeErrorForLog(value);
  }

  if (isRecord(value)) {
    const next: Record<string, unknown> = { ...value };
    if (next.error instanceof Error || isRecord(next.error)) {
      next.error = serializeErrorForLog(next.error);
    }
    if (next.cause instanceof Error || isRecord(next.cause)) {
      next.cause = serializeErrorForLog(next.cause);
    }
    return next;
  }

  return value;
}

function appendIfPresent(parts: string[], label: string, value: unknown): void {
  if (value === null || value === undefined) {
    return;
  }
  if (typeof value === "string" && value.trim().length === 0) {
    return;
  }

  parts.push(`${label}=${String(value)}`);
}

function truncateForConsole(value: string, maxChars = 400): string {
  if (value.length <= maxChars) {
    return value;
  }
  return `${value.slice(0, Math.max(0, maxChars - 15))}...[truncated]`;
}

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function formatPretty(record: LogRecord): string {
  const parts: string[] = [`[${record.timestamp}]`, record.level.toUpperCase(), record.event];
  appendIfPresent(parts, "traceId", record.traceId);
  appendIfPresent(parts, "layer", record.layer);
  appendIfPresent(parts, "path", record.requestPath);

  const data = isRecord(record.data) ? record.data : null;
  if (data) {
    appendIfPresent(parts, "direction", data.direction);
    appendIfPresent(parts, "module", data.module);
    appendIfPresent(parts, "source", data.source);
    appendIfPresent(parts, "method", data.method);
    appendIfPresent(parts, "url", data.url);
    appendIfPresent(parts, "status", data.status);
    appendIfPresent(parts, "durationMs", data.durationMs);
    appendIfPresent(parts, "attempt", data.attempt);
  }

  const lines = [parts.join(" ")];
  if (data) {
    if (typeof data.payloadPreview === "string" && data.payloadPreview.length > 0) {
      lines.push(`  payload=${truncateForConsole(data.payloadPreview, 500)}`);
    } else if (data.payload !== undefined && data.payload !== null) {
      lines.push(`  payload=${truncateForConsole(safeJson(data.payload), 500)}`);
    }

    if (isRecord(data.error)) {
      const errorLine: string[] = [];
      appendIfPresent(errorLine, "name", data.error.name);
      appendIfPresent(errorLine, "message", data.error.message);
      appendIfPresent(errorLine, "file", data.error.file);
      appendIfPresent(errorLine, "function", data.error.function);
      appendIfPresent(errorLine, "line", data.error.line);
      appendIfPresent(errorLine, "column", data.error.column);
      if (errorLine.length > 0) {
        lines.push(`  error=${errorLine.join(" ")}`);
      }
    }
  } else if (record.data !== undefined) {
    lines.push(`  data=${truncateForConsole(safeJson(record.data), 500)}`);
  }

  return lines.join("\n");
}

function log(level: LogLevel, event: string, data?: unknown): void {
  if (!shouldLog(level)) {
    return;
  }

  const trace = getTraceContext();
  const record: LogRecord = {
    timestamp: new Date().toISOString(),
    level,
    event,
  };

  if (trace?.traceId) {
    record.traceId = trace.traceId;
  }
  if (trace?.userId) {
    record.userId = trace.userId;
  }
  if (trace?.layer) {
    record.layer = trace.layer;
  }
  if (trace?.parentLayer) {
    record.parentLayer = trace.parentLayer;
  }
  if (trace?.requestPath) {
    record.requestPath = trace.requestPath;
  }
  if (trace?.requestMethod) {
    record.requestMethod = trace.requestMethod;
  }

  if (data !== undefined) {
    record.data = asErrorData(data);
  }

  const line = JSON.stringify(record);
  logSystem.writeLine(line);

  if (!printToConsole) {
    return;
  }

  const output = consoleFormat === "json" ? line : formatPretty(record);
  if (level === "error") {
    console.error(output);
    return;
  }

  if (level === "warn") {
    console.warn(output);
    return;
  }

  console.log(output);
}

export const logger = {
  debug: (event: string, data?: unknown) => {
    log("debug", event, data);
  },
  info: (event: string, data?: unknown) => {
    log("info", event, data);
  },
  success: (event: string, data?: unknown) => {
    log("info", event, data);
  },
  warn: (event: string, data?: unknown) => {
    log("warn", event, data);
  },
  error: (event: string, data?: unknown) => {
    log("error", event, data);
  },
  wire: (
    input: WireLogInput,
    options?: {
      force?: boolean;
      level?: LogLevel;
      event?: string;
    },
  ) => {
    if (!options?.force && !isVerboseWireLoggingEnabled()) {
      return;
    }

    log(options?.level || "info", options?.event || "wire.message", buildWireLogData(input));
  },
};

export function flushLogs(): Promise<void> {
  return logSystem.flush();
}
