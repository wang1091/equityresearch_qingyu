// Module-local pino logger. Only the competitive module uses pino for now;
// the rest of the codebase keeps the existing console-wrapping logger in
// server/utils.ts. If this works well we'll roll pino out elsewhere.
//
// Wrapper preserves the project-wide `(msg, data?)` call signature so the
// migration touches only imports — every existing logger.info() / .warn()
// / .error() / .debug() call works unchanged.

import pino, { Logger as PinoLogger } from "pino";
import { requestContext } from "../requestContext";

const isProd = process.env.NODE_ENV === "production";

const baseLogger: PinoLogger = pino({
  level: process.env.LOG_LEVEL || (isProd ? "info" : "debug"),
  base: { module: "competitive" },
  // mixin runs per-log-call and merges its return into the log object.
  // Pulls reqId/userId from AsyncLocalStorage so every log line is
  // automatically correlated to its originating HTTP request — no
  // need to thread reqId through function arguments.
  mixin() {
    const ctx = requestContext.getStore();
    if (!ctx) return {};
    return {
      reqId: ctx.reqId,
      ...(ctx.userId ? { userId: ctx.userId } : {}),
    };
  },
  redact: {
    // Mask anything that smells like a secret. paths use glob-ish syntax.
    paths: [
      "*.api_key", "*.apiKey",
      "*.password", "*.token", "*.secret",
      "headers.authorization", "headers.Authorization",
      "*.Authorization", "*.authorization",
    ],
    censor: "[REDACTED]",
  },
  transport: isProd
    ? undefined // prod: stream JSON to stdout for log aggregators
    : {
        target: "pino-pretty",
        options: {
          colorize: true,
          translateTime: "HH:MM:ss.l",
          ignore: "pid,hostname,module",
          // Show reqId prefix if present so dev terminal grep stays usable
          messageFormat: "[{module}]{if reqId} ({reqId}){end} {msg}",
        },
      },
});

// Our project-wide call signature is (msg: string, data?: any).
// pino's native API is (data, msg). This wrapper bridges them.
export interface CompetitiveLogger {
  info: (msg: string, data?: any) => void;
  success: (msg: string, data?: any) => void;
  warn: (msg: string, data?: any) => void;
  error: (msg: string, data?: any) => void;
  debug: (msg: string, data?: any) => void;
  child: (bindings: Record<string, any>) => CompetitiveLogger;
}

function wrap(p: PinoLogger): CompetitiveLogger {
  return {
    info: (msg, data) => p.info(data ?? {}, msg),
    success: (msg, data) => p.info({ ...(data ?? {}), success: true }, msg),
    warn: (msg, data) => p.warn(data ?? {}, msg),
    error: (msg, data) => {
      // If the second arg is an Error, pino prints stack via serializer.
      if (data instanceof Error) {
        p.error({ err: data }, msg);
      } else {
        p.error(data ?? {}, msg);
      }
    },
    debug: (msg, data) => p.debug(data ?? {}, msg),
    child: (bindings) => wrap(p.child(bindings)),
  };
}

// Default export: the competitive-scoped logger. Sub-modules can call
// logger.child({ submodule: "..." }) to add their own context.
export const logger: CompetitiveLogger = wrap(baseLogger);
