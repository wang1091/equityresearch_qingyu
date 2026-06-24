/**
 * Catalog of third-party API hosts we call directly. These are vendor-fixed
 * (not env-driven), so they live as plain constants — the point is a single
 * place where every external dependency is visible at a glance.
 *
 * Internal / proxied services (SmartNews, valuation, performance, stock-picker,
 * trending, ...) are env-driven and live in server/upstreamConfig.ts instead.
 */
export const DEEPSEEK_API = "https://api.deepseek.com";
export const PERPLEXITY_API = "https://api.perplexity.ai";
export const GEMINI_API = "https://generativelanguage.googleapis.com";
export const FMP_API = "https://financialmodelingprep.com";
export const YAHOO_QUERY1 = "https://query1.finance.yahoo.com";
export const YAHOO_QUERY2 = "https://query2.finance.yahoo.com";
