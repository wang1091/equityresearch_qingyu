/**
 * Trending stocks upstream fetch service. Extracted from routes/trending.ts
 * (per-source service split) — no behavior change. Both the Express route
 * (routes/trending.ts) and the agent plan registry (agent/planRegistry.ts) call
 * fetchTrending from here.
 */
import { resolveUpstreamBases } from "../upstreamConfig";
import { fetchJsonWithFallback } from "../upstreamFetch";

/** Upstream fetch timeout (per-source, owned by this service — matches FDA / STOCK_PICKER). */
const TRENDING_TIMEOUT_MS = 20000;

/** Fetch trending stocks from the upstream with local→public failover. `category`
 *  empty = the plain trending list; otherwise the stock-picker category variant.
 *  Returns the `{success:true, ...}` envelope. Exported so the agent (planRegistry)
 *  reaches the upstream through this same hardened path instead of a loopback
 *  self-call to /trending-stocks. Throws UpstreamFallbackError on total failure. */
export async function fetchTrending(lang: string, category: string): Promise<Record<string, unknown>> {
  const path = category
    ? `/api/stock-picker/trending/${encodeURIComponent(category)}?lang=${lang}`
    : `/api/trending?lang=${lang}`;
  const data = await fetchJsonWithFallback(
    resolveUpstreamBases("TRENDING").map((base) => ({
      url: `${base}${path}`,
      init: {},
      parse: (raw: unknown) => raw,
    })),
    { timeoutMs: TRENDING_TIMEOUT_MS, label: "TRENDING", errorTag: "TRENDING" },
  );
  return { success: true, ...(data as Record<string, unknown>) };
}

/** Trim the TRENDING payload for the LLM prompt. Extracted verbatim from
 *  generator.simplifyApiData — no behavior change. */
export function simplifyTrending(data: any): any {
  const cats = Array.isArray(data.categories)
    ? data.categories
    : data.category?.id
      ? [data.category]
      : data.id
        ? [data]
        : [];
  return {
    date: data.date,
    categories: cats.map((c: any) => ({
      id: c.id,
      label: c.label,
      stocks: (c.stocks || []).slice(0, 5).map((s: any) => ({
        ticker: s.ticker,
        companyName: s.companyName,
        price: s.price,
        changePercent: s.changePercent != null ? Number(s.changePercent).toFixed(2) + "%" : null,
        highlight: s.discussion_highlights?.[0] || null,
      })),
    })),
  };
}
