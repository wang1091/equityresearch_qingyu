// Request-scoped context propagated via AsyncLocalStorage.
//
// AsyncLocalStorage keeps a per-request "context bag" alive across all async
// hops triggered by the request (Express → service → strategy → fetch → ...).
// pino's `mixin` hook reads this on every log call to auto-attach reqId,
// userId, etc. — so business code doesn't have to thread reqId through
// function arguments.
//
// The middleware below installs this context per HTTP request. If you're
// running code outside an HTTP request (cron, scripts), the store is empty
// and the mixin contributes nothing — safe by default.

import type { NextFunction, Request, Response } from "express";
import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";

export interface RequestContext {
  reqId: string;
  startedAtNs: bigint;     // for total request duration measurement
  userId?: string;          // populated by auth middleware later
  path?: string;            // request path for filtering
  method?: string;
}

export const requestContext = new AsyncLocalStorage<RequestContext>();

// Express middleware: must run before any logging-emitting handler so that
// downstream `requestContext.getStore()` returns the populated context.
export function requestIdMiddleware(req: Request, res: Response, next: NextFunction): void {
  // Honor upstream-supplied id (e.g. from API gateway / load balancer)
  // for distributed tracing, fall back to a fresh UUID.
  const incoming = req.headers["x-request-id"];
  const reqId =
    typeof incoming === "string" && incoming.length > 0
      ? incoming
      : randomUUID();

  // Echo back so the client can correlate
  res.setHeader("x-request-id", reqId);

  const ctx: RequestContext = {
    reqId,
    startedAtNs: process.hrtime.bigint(),
    path: req.path,
    method: req.method,
  };

  requestContext.run(ctx, () => next());
}

/** Convenience: pull the current reqId, or undefined if outside a request. */
export function getReqId(): string | undefined {
  return requestContext.getStore()?.reqId;
}
