// Per-data-source RequestPlan builders. callSingleApi (apiCaller.ts) looks a
// source up HERE FIRST; a registered builder replaces that source's switch case,
// so the source is fetched via strategy/runPlan instead of a loopback self-HTTP
// call to the app's own /api/* route. Sources not yet migrated fall through to
// the legacy switch.
//
// Builder return shapes:
//   - createLocalPlan(thunk): wrap an existing service fn — keeps its hardening /
//     multi-step logic. Used for the self-call sources (the route handler was a
//     thin wrapper over such a service anyway).
//   - HttpRequestPlan: single-URL direct upstream call (none here yet).
import { createLocalPlan, type RequestPlan } from "../../strategy";
import type { DataSource } from "./intentSources";
import type { ApiCallContext } from "./apiCaller";
import { getMarketData } from "../marketData/marketDataService";
import { fetchFdaUpstream } from "../fda/service";
import { proxyRumorChatbot } from "../rumor/service";
import { fetchTrending } from "../trending/service";
import { fetchStockPrice, fetchSimilarStocks, fetchAnalystRating } from "../quotes/service";
import { localizeRumorData, localizeRatingData } from "./localize";
import { FDA_COMPANY_ALIASES } from "../config/fdaAliases";

export type PlanBuilder = (params: any, ctx?: ApiCallContext) => RequestPlan;

export const PLAN_REGISTRY: Partial<Record<DataSource, PlanBuilder>> = {
  // Was a loopback POST to /api/market-data, whose handler just calls
  // getMarketData. getMarketData is total (never throws — returns
  // {success:false,...} on failure), so the data is identical to the old path
  // for both success and failure.
  MARKET_DATA: (params) =>
    createLocalPlan(() => {
      const tickers: string[] = Array.isArray(params.tickers)
        ? params.tickers.map((t: string) => String(t).toUpperCase().trim()).filter(Boolean)
        : params.ticker
          ? [String(params.ticker).toUpperCase().trim()]
          : [];
      return getMarketData({
        tickers,
        queryType: params.queryType || "general",
        fromDate: params.fromDate,
        toDate: params.toDate,
        question: typeof params.question === "string" ? params.question : "",
        lang: params.lang === "zh" ? "zh" : "en",
      });
    }),

  // Was a loopback GET to /api/fda/companies[/:ticker], whose handler just calls
  // fetchFdaUpstream. We build the upstream path directly (the route's company-vs-
  // ticker mapping, including the company-alias resolution apiCaller did) and call
  // the same hardened proxy. No localization on this source.
  FDA: (params) =>
    createLocalPlan(() => {
      const queryText = String(params.query || params.companyName || "");
      const aliasCompany = Object.entries(FDA_COMPANY_ALIASES).find(([alias]) =>
        queryText.includes(alias),
      )?.[1];
      const companyName = aliasCompany || params.companyName;
      const upstreamPath =
        companyName && !params.ticker
          ? `/api/companies/search?company=${encodeURIComponent(companyName)}`
          : `/api/companies/${params.ticker || companyName || ""}`;
      return fetchFdaUpstream(upstreamPath);
    }),

  // Was a loopback POST to /api/rumor-check/chatbot, whose handler is proxyRumorChatbot
  // (internal :3000 → legacy detect-rumor failover). A non-OK upstream throws inside
  // the proxy; a logical {success:false} still throws here (mirrors the old case),
  // then localize. Failure → callSingleApi catch → success:false (filtered by generator).
  RUMOR: (params) =>
    createLocalPlan(async () => {
      const data = await proxyRumorChatbot({
        query: params.query,
        language: params.language || params.lang || "auto",
        include_raw: true,
      });
      if (data?.success === false) {
        throw new Error((data?.error as string) || "RUMOR upstream failed");
      }
      return localizeRumorData(data, params.language || params.lang);
    }),

  // Was a loopback GET to /api/trending-stocks, whose handler is fetchTrending.
  // apiCaller's category="all" maps to the no-category (plain trending) variant.
  TRENDING: (params) =>
    createLocalPlan(() => {
      const rawCategory = params.category || "all";
      const lang = params.lang || params.language || "en";
      return fetchTrending(lang, rawCategory === "all" ? "" : rawCategory);
    }),

  // Was a loopback GET to /api/stock-price/:ticker (agent sent no query → service
  // defaults range=1d/interval=2m/includeHistory=true).
  STOCK_PRICE: (params) => createLocalPlan(() => fetchStockPrice(params.ticker)),

  // Was a loopback GET to /api/similar-stocks/:ticker.
  PEER_STOCKS: (params) => createLocalPlan(() => fetchSimilarStocks(params.ticker)),

  // Was a loopback GET to /api/analyst-ratings/:ticker[/detail]: multi-intent →
  // simplified shape, single-intent → detailed card. Then localize (handles both).
  RATING: (params) =>
    createLocalPlan(async () => {
      const detail = (params.requiredData?.length || 1) <= 1;
      const data = await fetchAnalystRating(params.ticker, { detail });
      return localizeRatingData(data, params.lang);
    }),
};
