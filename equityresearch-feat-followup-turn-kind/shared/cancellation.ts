export const CANCELLATION_REASONS = [
  "client_disconnect",
  "client_abort",
  "pipeline_timeout",
  "upstream_timeout",
  "unknown_abort",
] as const;

export type CancellationReason = (typeof CANCELLATION_REASONS)[number];

export function isCancellationReason(value: unknown): value is CancellationReason {
  return typeof value === "string" && (CANCELLATION_REASONS as readonly string[]).includes(value);
}
