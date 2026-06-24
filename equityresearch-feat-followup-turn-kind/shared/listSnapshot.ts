// ListSnapshot — the strongly-typed "result set we actually showed last turn"
// (turn_kind Phase 4b-0 foundation). It is the ONE place raw list payloads
// (TRENDING / STOCK_PICKER) are turned into a uniform, computable structure:
//
//   raw payload ──extractListSnapshot()──▶ ListSnapshot ─┬─ computed RECALL / DRILL_IN (4b-1+, read structure)
//                                                        └─ history projection (lossy text view of view.items)
//
// Why this exists (the Rev-1 hard truth): the Phase-4a LastAnswerSnapshot.validData
// is NOT usable as "the list we showed" — simplifyTrending slice(0,5)s + stringifies
// changePercent ("55.87%"), and the picker-trending list lives nested in
// results[0].category.stocks. Three views of the same data with three different
// ranges. So 4b builds its OWN typed snapshot from the RAW render payload, with the
// same item set + order the UI shows and every metric a finite number | null.
//
// SCOPE (4b-0): TRENDING + STOCK_PICKER (trending + comparison/score) only.
// MARKET_DATA (multi-ticker → no card / not a ranked leaderboard) is a later adapter
// (docs/TURN_KIND_PHASE_4B_PLAN.md 接线-4).

/** A list element. `ticker` may be null (a picker score-off keyed only by name): a
 *  null-ticker item can be shown / computed over but never drilled or materialized
 *  into a fan-out set. `metrics` are STRICTLY finite number | null — never NaN, never
 *  a "%"-string (the source of the Rev-2 silent no-op sort bug). */
export interface ListItem {
  ticker: string | null;
  name: string;
  metrics: Record<string, number | null>;
}

/** How a view is ordered — a numeric axis (top_gainers = changePercent desc) or the
 *  provider's own order (most_active / most_discussed carry NO volume/count field, so
 *  they can only answer "the top one", never fabricate a magnitude). */
export type Ranking =
  | { kind: "metric"; field: string; direction: "asc" | "desc" }
  | { kind: "provider_order"; semantic: string };

/** One ranked list (a TRENDING category, a picker leaderboard, a score-off). */
export interface ListView {
  id: string;
  label: string;
  items: ListItem[];
  ranking: Ranking;
  /** Lens carried for DRILL_IN inheritance (a ListView has no queryType/date of its
   *  own). `asOf` is the upstream display date (TRENDING payload.date) for projection. */
  context?: { queryType?: string; fromDate?: string; toDate?: string; asOf?: string };
}

/** The full result set shown last turn — possibly multiple coexisting views (TRENDING
 *  returns up to four: top_gainers / top_losers / most_active / most_discussed). */
export interface ListSnapshot {
  source: string;
  /** ISO capture time (when the snapshot was built). NOT the upstream data date — that
   *  is per-view context.asOf. */
  capturedAt: string;
  views: ListView[];
}

// ── strict numeric parsing ───────────────────────────────────────────────────
// A metric MUST end up a finite number | null. Number("55.87%") is NaN, and a NaN
// sort comparator returns NaN (treated as "equal") → a stable-sort no-op that looks
// like a correct answer (Rev-2). So parse strictly: accept a number, or a numeric
// string with at most one trailing "%", reject anything else (incl. "55.87%garbage").

/** "55.87%" → 55.87 · 55.87 → 55.87 · "abc"/"55%x" → null. */
export function parsePct(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v !== "string") return null;
  const m = /^([+-]?\d+(?:\.\d+)?)\s*%?$/.exec(v.trim());
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : null;
}

/** Plain numeric field (price / finalScore): number, or a clean numeric string. */
export function parseNum(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v !== "string") return null;
  const s = v.trim();
  if (s === "") return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

// ── view registry (static NL→axis semantics) ─────────────────────────────────
// Maps a known list id to its ranking axis. most_active / most_discussed are
// provider_order: their rows DO carry changePercent (so "活跃股里涨最多" is computable
// in 4b-1) but NO volume/discussion-count field, so a magnitude on those axes must be
// re-fetched, never invented.
interface ViewSpec {
  ranking: Ranking;
}
export const VIEW_REGISTRY: Record<string, ViewSpec> = {
  top_gainers: { ranking: { kind: "metric", field: "changePercent", direction: "desc" } },
  top_losers: { ranking: { kind: "metric", field: "changePercent", direction: "asc" } },
  most_active: { ranking: { kind: "provider_order", semantic: "most_active" } },
  most_discussed: { ranking: { kind: "provider_order", semantic: "most_discussed" } },
};
const DEFAULT_TRENDING_RANKING: Ranking = { kind: "provider_order", semantic: "trending" };

// ── source adapters (normalize raw shape → views, per (source, mode)) ─────────
interface RawViewGroup {
  id: string;
  label: string;
  rawItems: any[];
  ranking: Ranking;
  context?: ListView["context"];
}

/** Per-source normalizer: split raw payload into view groups, then identify + measure
 *  each raw element. Keeps the shape divergence (TRENDING ticker/companyName vs picker
 *  score-off name-only vs picker-trending nested category.stocks) in ONE place. */
export interface SourceListAdapter {
  views(raw: any): RawViewGroup[];
  identify(rawItem: any): { ticker: string | null; name: string };
  metrics(rawItem: any): Record<string, number | null>;
}

/** TRENDING categories: categories[] | {category} | self — mirrors simplifyTrending. */
function resolveTrendingCategories(raw: any): any[] {
  if (Array.isArray(raw?.categories)) return raw.categories;
  if (raw?.category?.id) return [raw.category];
  if (raw?.id) return [raw];
  return [];
}

const TRENDING_ADAPTER: SourceListAdapter = {
  views(raw) {
    const asOf = typeof raw?.date === "string" ? raw.date : undefined;
    return resolveTrendingCategories(raw)
      .filter((c) => Array.isArray(c?.stocks) && c.stocks.length > 0)
      .map((c) => ({
        id: c.id || "all",
        label: c.label || c.id || "all",
        rawItems: c.stocks,
        ranking: VIEW_REGISTRY[c.id]?.ranking ?? DEFAULT_TRENDING_RANKING,
        context: asOf ? { asOf } : undefined,
      }));
  },
  identify: (s) => ({ ticker: s?.ticker ?? null, name: String(s?.companyName ?? "") }),
  metrics: (s) => ({ changePercent: parsePct(s?.changePercent), price: parseNum(s?.price) }),
};

const STOCK_PICKER_ADAPTER: SourceListAdapter = {
  views(raw) {
    const results: any[] = Array.isArray(raw?.results) ? raw.results : [];

    // trending/screener mode: the real leaderboard is nested in results[0].category.stocks
    // (results itself is length-1 wrapper). Same item shape as TRENDING.
    if (raw?.mode === "trending") {
      const cat = results[0]?.category;
      const stocks: any[] = Array.isArray(cat?.stocks) ? cat.stocks : [];
      if (stocks.length === 0) return [];
      return [{
        id: cat?.id ? `trending ${cat.id}` : "trending",
        label: cat?.label || cat?.id || "trending",
        rawItems: stocks,
        ranking: VIEW_REGISTRY[cat?.id]?.ranking ?? DEFAULT_TRENDING_RANKING,
      }];
    }

    // comparison / single (score-off): one view ranked by finalScore. Carry the
    // index-aligned label so identify() can prefer it (the upstream-resolved ticker).
    if (results.length === 0) return [];
    const labels: string[] = Array.isArray(raw?.labels) ? raw.labels : [];
    return [{
      id: String(raw?.mode || "score"),
      label: String(raw?.mode || "score"),
      rawItems: results.map((r, i) => ({ __label: labels[i], ...r })),
      ranking: { kind: "metric", field: "finalScore", direction: "desc" },
    }];
  },
  identify: (r) => ({
    ticker: (r?.__label ?? r?.ticker) || null,
    name: String(r?.companyName ?? r?.__label ?? r?.ticker ?? ""),
  }),
  // A trending stock carries changePercent (no finalScore); a score result the reverse —
  // strict parse yields the present axis, null for the absent one (both valid).
  metrics: (r) => ({
    changePercent: parsePct(r?.changePercent),
    finalScore: parseNum(r?.finalScore),
    price: parseNum(r?.price),
  }),
};

const ADAPTERS: Record<string, SourceListAdapter> = {
  TRENDING: TRENDING_ADAPTER,
  STOCK_PICKER: STOCK_PICKER_ADAPTER,
};

/**
 * Build the typed snapshot from a RAW render payload. Returns null for unsupported
 * sources, error/empty payloads, or payloads that yield no non-empty view. The item
 * set + order match what the card renders (the projection is a lossy text view of the
 * SAME items — see shared/listProjection.ts).
 */
export function extractListSnapshot(source: string, raw: any): ListSnapshot | null {
  if (!raw || raw.success === false || raw.error) return null;
  const adapter = ADAPTERS[source];
  if (!adapter) return null;

  const views: ListView[] = adapter
    .views(raw)
    .map((g) => ({
      id: g.id,
      label: g.label,
      ranking: g.ranking,
      context: g.context,
      items: g.rawItems.map((ri): ListItem => {
        const { ticker, name } = adapter.identify(ri);
        return { ticker: ticker || null, name, metrics: adapter.metrics(ri) };
      }),
    }))
    .filter((v) => v.items.length > 0);

  if (views.length === 0) return null;
  return { source, capturedAt: new Date().toISOString(), views };
}

/** A view with ≥2 routable (non-null ticker) items — the §1.6 bar for an operable
 *  activeList (a single-ticker card is not a list to screen/drill over). */
export function hasRoutableView(snapshot: ListSnapshot): boolean {
  return snapshot.views.some((v) => v.items.filter((i) => i.ticker).length >= 2);
}

/** Rows the card actually renders per view (formatTrendingCard slice(0,10)). The
 *  EXTRACTOR stays faithful to the full upstream set (the classifier-history projection
 *  deliberately routes over the broader set); only the activeList — the substrate for
 *  ordinal/computed follow-ups — is capped to what the user actually SAW (plan §F). */
export const LIST_VISIBLE_LIMIT = 10;

/** Trim each view to the UI-visible row count. Used when building the activeList from a
 *  rendered list card, so "第 N 个 / 涨最多" never resolves a row beyond the card. */
export function capToVisible(snapshot: ListSnapshot, limit = LIST_VISIBLE_LIMIT): ListSnapshot {
  return {
    ...snapshot,
    views: snapshot.views.map((v) =>
      v.items.length > limit ? { ...v, items: v.items.slice(0, limit) } : v,
    ),
  };
}
