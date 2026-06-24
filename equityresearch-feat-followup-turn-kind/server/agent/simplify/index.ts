// Per-data-source LLM-prompt simplifiers. simplifyApiData (generator.ts) looks a
// source up in SIMPLIFY_REGISTRY; an unregistered source falls back to
// simplifyDefault. Mirrors the PLAN_REGISTRY pattern (planRegistry.ts): each
// simplifier is colocated with its source's fetch service where one exists
// (quotes/fda/trending/marketData/performance/competitive/earnings/stockPicker),
// and the two stream-only sources without a service module (VALUATION, NEWS)
// live in this directory.
//
// The per-source trimming bodies were extracted verbatim from the old
// generator.simplifyApiData switch — no behavior change (locked by
// simplify.snapshot.test.ts).
import type { DataSource } from "../intentSources";
import { simplifyEarnings } from "../../earnings/service";
import { simplifyStockPicker } from "../../stockPicker/service";
import { simplifyPerformance } from "../../performance/service";
import { simplifyCompetitive } from "../../competitive/service";
import { simplifyMarketData } from "../../marketData/marketDataService";
import { simplifyFda } from "../../fda/service";
import { simplifyTrending } from "../../trending/service";
import {
  simplifyStockPrice,
  simplifyRating,
  simplifyPeerStocks,
} from "../../quotes/service";
import { simplifyValuation } from "./valuation";
import { simplifyNews } from "./news";

export type SimplifyFn = (data: any) => any;

export const SIMPLIFY_REGISTRY: Partial<Record<DataSource, SimplifyFn>> = {
  VALUATION: simplifyValuation,
  NEWS: simplifyNews,
  EARNINGS: simplifyEarnings,
  COMPETITIVE: simplifyCompetitive,
  STOCK_PICKER: simplifyStockPicker,
  PERFORMANCE: simplifyPerformance,
  RATING: simplifyRating,
  STOCK_PRICE: simplifyStockPrice,
  PEER_STOCKS: simplifyPeerStocks,
  FDA: simplifyFda,
  MARKET_DATA: simplifyMarketData,
  TRENDING: simplifyTrending,
};

/** Fallback for sources with no registered simplifier: cap long strings/arrays. */
export function simplifyDefault(data: any): any {
  if (typeof data === "string") return data.substring(0, 1000);
  if (Array.isArray(data)) return data.slice(0, 5);
  if (typeof data === "object") {
    const cleaned = { ...data };
    for (const key in cleaned) {
      if (typeof cleaned[key] === "string" && cleaned[key].length > 500) {
        cleaned[key] = cleaned[key].substring(0, 500) + "...";
      }
    }
    return cleaned;
  }
  return data;
}

/**
 * Trim each raw API payload down to the fields the LLM prompt needs. Failed
 * sources ({ error } / falsy) pass through untouched so the caller can filter
 * them out. Array payloads (multi-ticker fan-out) are simplified element-wise.
 */
export function simplifyApiData(apiData: Record<string, any>): Record<string, any> {
  const simplified: Record<string, any> = {};

  const run = (source: string, data: any) => {
    if (!data || data.error) return data;
    const fn = SIMPLIFY_REGISTRY[source as DataSource] ?? simplifyDefault;
    return fn(data);
  };

  for (const [source, data] of Object.entries(apiData)) {
    simplified[source] = Array.isArray(data)
      ? data.map((item: any) => run(source, item))
      : run(source, data);
  }

  return simplified;
}

/**
 * Snapshot-only valid data (turn_kind Phase 4a): simplifyApiData + a PER-ELEMENT
 * failure filter. Unlike the generator's top-level `d.error` filter
 * (generator.ts:321/503), this drops failed elements *inside* a multi-ticker array,
 * and removes a source key whose array empties out entirely — otherwise
 * retrievedSourceKeys / buildSources would treat an all-failed source as a real
 * origin. Used ONLY by buildSnapshot; the generator filter stays as-is to keep 4a
 * strictly additive (its multi-ticker leak is a separate follow-up — see
 * docs/TURN_KIND_PHASE_4A_PLAN.md §1).
 */
export function buildValidData(apiData: Record<string, any>): Record<string, any> {
  const out: Record<string, any> = {};
  for (const [source, data] of Object.entries(simplifyApiData(apiData))) {
    if (Array.isArray(data)) {
      const kept = data.filter((item: any) => item && !item.error);
      if (kept.length > 0) out[source] = kept;
    } else if (data && !data.error) {
      out[source] = data;
    }
  }
  return out;
}
