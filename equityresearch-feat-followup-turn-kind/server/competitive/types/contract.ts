// Contract-level constants and the closed error-code enum.
// Anything in here is documented in COMPETITIVE_API_CONTRACT.md and
// requires a version bump to change.

export const CONTRACT_VERSION = "1.0";

// Identifier of THIS module's implementation (Node + DeepSeek). Surfaced
// in _meta.provider so consumers can tell which backend served them.
export const PROVIDER_ID = "node-deepseek";

export type ErrorCode =
  | "MISSING_COMPANY_NAME"
  | "INVALID_INPUT"
  | "UPSTREAM_PERPLEXITY_FAILED"
  | "UPSTREAM_LLM_FAILED"
  | "TIMEOUT"
  | "INTERNAL";
