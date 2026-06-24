// Monotonic high-resolution timing helpers.
//
// process.hrtime.bigint() returns nanoseconds since process start. It's:
//   - monotonic (not affected by NTP / wall-clock jumps)
//   - sub-millisecond precision (~100ns OS scheduler granularity)
//   - returns BigInt (use Number(...) / 1e6 to convert to ms float)
//
// Use cases:
//   - measuring durations that may need < 1ms precision (cache lookups,
//     in-process branches, micro-benchmarks)
//   - guaranteeing the elapsed duration is never negative or skipping
//     forward due to clock adjustments
//
// For 30s+ network calls (our COMPETITIVE flow), Date.now() would be
// fine — but using hrtime here gives us a single, consistent timing
// API across the module and protects us if anyone ever instruments a
// hot path inside this module.

import { hrtime } from "node:process";

/** Returns a high-res nanosecond timestamp (monotonic). */
export function nowNs(): bigint {
  return hrtime.bigint();
}

/** Returns milliseconds elapsed since `startNs` as a float. */
export function elapsedMs(startNs: bigint): number {
  const elapsedNs = hrtime.bigint() - startNs;
  return Number(elapsedNs) / 1_000_000;
}

/** Returns nanoseconds elapsed since `startNs` as a BigInt. */
export function elapsedNs(startNs: bigint): bigint {
  return hrtime.bigint() - startNs;
}
