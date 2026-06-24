import { ErrorCode } from "./types";

// Errors thrown anywhere in the competitive module carry a contract-aligned
// `code` so the HTTP handler can map directly to status + response shape.
//
// `metaContext` is an optional bag of partial-state fields the handler
// will merge into `_meta` of the error response — used so that when
// analysis fails AFTER research succeeded, the response still surfaces
// research_provider / research_ms etc. for diagnosis (reviewer I7).
export class CompetitiveError extends Error {
  constructor(
    public readonly code: ErrorCode,
    message: string,
    public readonly metaContext?: Record<string, unknown>
  ) {
    super(message);
    this.name = "CompetitiveError";
  }
}
