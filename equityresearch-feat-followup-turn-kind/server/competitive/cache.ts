// In-process TTL cache for competitive analysis results.
//
// Why: every POST /api/competitive-analysis triggers a fresh research+LLM
// pipeline (~25–50s, temperature>0 so non-deterministic). BOTH consumers —
// the standalone /competitive page and the agent's `node` provider path —
// hit this same endpoint, so caching here makes a repeated "MU competitive"
// return instantly AND identically within the TTL window, for both entries.
//
// Scope: single process. Multiple Node workers each keep their own cache
// (fine for dev / single instance; use a shared store like Redis if you
// later run a cluster and need cross-worker consistency).
//
// Only SUCCESS responses are cached — a transient research timeout or
// upstream LLM failure must not be pinned for the whole TTL.

import { logger } from "./logger";
import type { ValidatedRequest } from "./schemas";
import type { CompetitiveAnalysisSuccessResponse } from "./types/wire";

// Env is read lazily (not at import time) so it works regardless of whether
// dotenv ran before this module was first imported, and so a bad value
// falls back to the default instead of silently disabling the cache.
function num(value: string | undefined, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}
function ttlMs(): number {
  return num(process.env.COMPETITIVE_CACHE_TTL_MS, 30 * 60 * 1000); // 30 min
}
function maxEntries(): number {
  return num(process.env.COMPETITIVE_CACHE_MAX, 500);
}

interface Entry {
  result: CompetitiveAnalysisSuccessResponse;
  storedAt: number; // epoch ms
}

const completed = new Map<string, Entry>();
const inflight = new Map<string, Promise<CompetitiveAnalysisSuccessResponse>>();

// Cache key = every input that changes the output. lang/verbose are
// normalized to their effective defaults so "no lang" and "en" share one
// entry.
//
// Company identity: when a ticker is present it uniquely identifies the
// company, so we key on the ticker ALONE and ignore companyName — the
// standalone page sends "Micron" while the agent may send "MU", and we
// want both entry points to share one entry. Fall back to companyName
// only when there is no ticker.
export function cacheKey(input: ValidatedRequest): string {
  const ticker = input.ticker?.trim().toUpperCase() || "";
  const identity = ticker
    ? `t:${ticker}`
    : `c:${input.companyName?.trim().toLowerCase() || ""}`;
  return JSON.stringify({
    id: identity,
    i: input.industry?.trim() || "",
    x: input.additionalContext?.trim() || "",
    l: input.lang || "en",
    v: input.verbose ?? false,
  });
}

export interface CacheResult {
  result: CompetitiveAnalysisSuccessResponse;
  cached: boolean; // true if served from a completed entry or a deduped in-flight run
  ageMs: number; // age of the cached entry; 0 for a freshly computed result
}

function label(input: ValidatedRequest): string {
  return input.ticker || input.companyName || "?";
}

// Returns a cached result, joins an identical in-flight request, or runs
// `compute` and caches its success. `compute` is only invoked on a true miss.
export async function getOrCompute(
  input: ValidatedRequest,
  compute: () => Promise<CompetitiveAnalysisSuccessResponse>,
): Promise<CacheResult> {
  const ttl = ttlMs();
  if (ttl <= 0) return { result: await compute(), cached: false, ageMs: 0 };

  const key = cacheKey(input);

  const hit = completed.get(key);
  if (hit) {
    const age = Date.now() - hit.storedAt;
    if (age < ttl) {
      logger.info(`🗃️  competitive cache HIT (${label(input)}, age ${age}ms)`);
      return { result: hit.result, cached: true, ageMs: age };
    }
    completed.delete(key); // expired
  }

  // Coalesce concurrent identical requests onto a single pipeline run.
  const pending = inflight.get(key);
  if (pending) {
    logger.info(`🗃️  competitive cache JOIN in-flight (${label(input)})`);
    return { result: await pending, cached: true, ageMs: 0 };
  }

  const promise = compute();
  inflight.set(key, promise);
  try {
    const result = await promise;
    store(key, result);
    return { result, cached: false, ageMs: 0 };
  } finally {
    // Always release the in-flight slot — on success the entry is now in
    // `completed`; on failure we deliberately leave nothing cached.
    inflight.delete(key);
  }
}

function store(key: string, result: CompetitiveAnalysisSuccessResponse): void {
  // Bound memory: evict oldest insertion (Map preserves insertion order)
  // once over the cap. Simple FIFO is enough — entries also self-expire.
  const cap = maxEntries();
  while (completed.size >= cap && cap > 0) {
    const oldest = completed.keys().next().value;
    if (oldest === undefined) break;
    completed.delete(oldest);
  }
  completed.set(key, { result, storedAt: Date.now() });
}

// Test / ops hook.
export function clearCompetitiveCache(): void {
  completed.clear();
  inflight.clear();
}
