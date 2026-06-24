// Deterministic per-ticker fan-out for set follow-ups (docs/HISTORY_PROJECTION_PLAN.md
// step c; docs/FOLLOWUP_TURN_GATE_DESIGN.md §九; PLAN_CONSOLIDATION_PLAN.md Step 3).
// When a turn carries ≥2 tickers, the LLM's api_params shape is unreliable — e.g. it
// emits VALUATION as a per-ticker array (correct) but PERFORMANCE as {tickers:[…]}
// (which the service reads as primary+peers → only the first is analyzed). TS
// deterministically shapes the fan-out from typed entities — the LLM decides WHICH
// tickers + WHICH lens + each ticker's ROLE; TS shapes the call — never trusting the
// LLM to emit the array form consistently.
//
// Role drives the fan-out set per source:
//   - PERFORMANCE: fan only the TARGET entities. Its multi-ticker call is "primary +
//     peers, one call" (server/performance/service.ts:25), so PEER entities fold into
//     a single call. A set-screen frames every ticker as TARGET → fans out per ticker;
//     a comparison frames one TARGET + peers → 1 target → single peer call. (This
//     replaces the old includePerformance boolean threaded from isSetScreen.)
//   - VALUATION / RATING / STOCK_PRICE: independent per-ticker call, no peer semantic —
//     fan ALL entities (TARGET ∪ PEER).
//   - MARKET_DATA (native tickers[]), STOCK_PICKER (score-off tickers[]), EARNINGS
//     (collapse path), NEWS / RUMOR / GENERAL (query-based): untouched.

/** Sources whose per-ticker call is independent — fan ALL entities. */
const FANOUT_SOURCES = new Set(["VALUATION", "RATING", "STOCK_PRICE"]);

/** Cap parallel fan-out (the history projection already bounds the set ~10). */
const MAX_FANOUT = 8;

/** PERFORMANCE is a heavy call (peer analysis) — smaller cap when screen-fanned. */
const PERFORMANCE_MAX_FANOUT = 5;

/** A ticker's role within the turn. BENCHMARK is reserved (no consumer yet). */
export type EntityRole = "TARGET" | "PEER";

export interface RoledEntity {
  symbol: string;
  role: EntityRole;
}

/** Drop ticker-identifying keys, keep the rest (query / lang / …) as the per-call base. */
export function baseParams(param: unknown): Record<string, any> {
  const src = Array.isArray(param) ? param[0] : param;
  if (!src || typeof src !== "object") return {};
  const { ticker: _t, tickers: _ts, ...rest } = src as Record<string, any>;
  return rest;
}

/** Uppercase, trim, dedupe (order-preserving) the symbols of entities matching `pred`. */
function normalizeSymbols(
  entities: RoledEntity[],
  pred: (e: RoledEntity) => boolean,
): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const e of entities) {
    if (!pred(e)) continue;
    const sym = String(e.symbol).toUpperCase().trim();
    if (sym && !seen.has(sym)) {
      seen.add(sym);
      out.push(sym);
    }
  }
  return out;
}

/**
 * Rewrite api_params for the per-ticker sources into the per-ticker array form, driven
 * by entity roles (see file header). Returns a new object; sources not fanned pass
 * through untouched. No-op (returns the input unchanged) when there are no entities.
 */
export function fanOutByRole(
  apiParams: Record<string, any> | undefined,
  entities: RoledEntity[] | undefined,
  requiredData: string[] | undefined,
): Record<string, any> | undefined {
  if (!Array.isArray(entities) || entities.length === 0) return apiParams;

  const allSet = normalizeSymbols(entities, () => true);
  const targetSet = normalizeSymbols(entities, (e) => e.role === "TARGET");

  const out: Record<string, any> = { ...(apiParams ?? {}) };
  for (const source of requiredData ?? []) {
    const fanSet =
      source === "PERFORMANCE"
        ? targetSet
        : FANOUT_SOURCES.has(source)
          ? allSet
          : null;
    if (!fanSet || fanSet.length < 2) continue;
    const cap = source === "PERFORMANCE" ? PERFORMANCE_MAX_FANOUT : MAX_FANOUT;
    const base = baseParams(out[source]);
    out[source] = fanSet.slice(0, cap).map((ticker) => ({ ...base, ticker }));
  }
  return out;
}
