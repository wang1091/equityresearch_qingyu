import { getLocalApiBase } from "./localApi";

/**
 * Single declarative source of truth for every upstream base URL — the in-code
 * mirror of the EC2 nginx port map. Change a port / domain / failover policy in
 * the UPSTREAMS table below and nowhere else. The app AND the health probe
 * (server/health.ts) read from here, and the cross-URL failover assembly
 * (server/agent/apiCaller.ts via resolveUpstreamBases) is driven by the same
 * table — no parallel hardcoded list to drift.
 */
const PROD_SMARTNEWS_BASE = "https://smartnews.checkitanalytics.com";
const PROD_STOCK_PICKER_BASE = "https://stockpick.checkitanalytics.com";
const PROD_KEYMETRICS_BASE = "https://keymetrics.checkitanalytics.com";
const PROD_FDA_BASE = "https://fdacalendar.checkitanalytics.com";

function normalizeBaseUrl(url: string): string {
  return url.trim().replace(/\/+$/, "");
}

/** Resolve an env var to a base URL, else the given default. */
function resolve(value: string | undefined, fallback: string): string {
  return value && value.trim().length > 0 ? normalizeBaseUrl(value) : fallback;
}

/** A localhost / loopback base — the trigger for appending a public fallback. */
export function isLocalBase(url: string): boolean {
  try {
    const host = new URL(url).hostname;
    return host === "localhost" || host === "127.0.0.1" || host === "0.0.0.0";
  } catch {
    return /localhost|127\.0\.0\.1|0\.0\.0\.0/.test(url);
  }
}

interface UpstreamSpec {
  /** Primary-base override env vars, in priority order. */
  envVars: string[];
  /** Primary base when no env var is set (static, or computed from env). */
  defaultPrimary: string | ((env: NodeJS.ProcessEnv) => string);
  /** When set, resolveUpstreamBases appends this public fallback if the primary
   *  is a local base. The fallback itself is env-overridable. */
  failover?: { envVar: string; default: string };
}

export type UpstreamName =
  | "NEWS"
  | "SMARTNEWS"
  | "VALUATION"
  | "PERFORMANCE"
  | "STOCK_PICKER"
  | "TRENDING"
  | "COMPETITIVE"
  | "FDA"
  | "RUMOR";

const UPSTREAMS: Record<UpstreamName, UpstreamSpec> = {
  // NEWS: two override keys; default is dev=local loopback, prod=public.
  // Fails over to the SmartNews public domain when the primary is local.
  NEWS: {
    envVars: ["NEWS_API_BASE_URL", "API_BASE_URL"],
    defaultPrimary: (env) =>
      env.NODE_ENV !== "production" ? getLocalApiBase(env) : PROD_SMARTNEWS_BASE,
    failover: { envVar: "SMARTNEWS_API_URL", default: PROD_SMARTNEWS_BASE },
  },
  // SmartNews backend (also the NEWS/EARNINGS failover target). :5000
  SMARTNEWS: { envVars: ["SMARTNEWS_API_URL"], defaultPrimary: PROD_SMARTNEWS_BASE },
  // Valuation JSON API :8503 → public valuation domain on failover.
  VALUATION: {
    envVars: ["VALUATION_API_URL"],
    defaultPrimary: "http://localhost:8503",
    failover: { envVar: "VALUATION_FALLBACK_URL", default: "https://valuation.checkitanalytics.com" },
  },
  // Keymetrics :8502 → public keymetrics domain on failover.
  PERFORMANCE: {
    envVars: ["PERFORMANCE_API_URL"],
    defaultPrimary: "http://localhost:8502",
    failover: { envVar: "PERFORMANCE_FALLBACK_URL", default: PROD_KEYMETRICS_BASE },
  },
  // Stockpick :5656 → public stockpick domain on failover (default flipped to local).
  STOCK_PICKER: {
    envVars: ["STOCK_PICKER_API_URL"],
    defaultPrimary: "http://127.0.0.1:5656",
    failover: { envVar: "STOCK_PICKER_FALLBACK_URL", default: PROD_STOCK_PICKER_BASE },
  },
  // Same backend as stockpick :5656 → public stockpick domain on failover.
  TRENDING: {
    envVars: ["TRENDING_API_URL"],
    defaultPrimary: "http://localhost:5656",
    failover: { envVar: "TRENDING_FALLBACK_URL", default: PROD_STOCK_PICKER_BASE },
  },
  COMPETITIVE: { envVars: ["COMPETITIVE_FLASK_URL"], defaultPrimary: "http://localhost:8081" }, // Industry/Porter :8081
  // FDA :5002 → public FDA calendar domain on failover (default flipped to local).
  FDA: {
    envVars: ["FDA_API_BASE_URL"],
    defaultPrimary: "http://127.0.0.1:5002",
    failover: { envVar: "FDA_FALLBACK_URL", default: PROD_FDA_BASE },
  },
  RUMOR: { envVars: ["RUMOR_CHATBOT_INTERNAL_URL"], defaultPrimary: "http://localhost:3000" }, // rumorcheck :3000
};

function firstEnvValue(envVars: string[], env: NodeJS.ProcessEnv): string | undefined {
  for (const key of envVars) {
    const value = env[key];
    if (value && value.trim().length > 0) return value;
  }
  return undefined;
}

/** Primary base for an upstream: first env override, else its documented default. */
export function resolveUpstreamPrimary(
  name: UpstreamName,
  env: NodeJS.ProcessEnv = process.env,
): string {
  const spec = UPSTREAMS[name];
  const override = firstEnvValue(spec.envVars, env);
  if (override) return normalizeBaseUrl(override);
  return typeof spec.defaultPrimary === "function" ? spec.defaultPrimary(env) : spec.defaultPrimary;
}

/** Public failover base for an upstream (undefined if it doesn't fail over). */
export function resolveUpstreamFallback(
  name: UpstreamName,
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  const spec = UPSTREAMS[name];
  if (!spec.failover) return undefined;
  return resolve(env[spec.failover.envVar], spec.failover.default);
}

/** Ordered base list for the cross-URL failover loop (server/upstreamFetch.ts):
 *  the primary, plus the public fallback when the primary is a local base. */
export function resolveUpstreamBases(
  name: UpstreamName,
  env: NodeJS.ProcessEnv = process.env,
): string[] {
  const primary = resolveUpstreamPrimary(name, env);
  const fallback = resolveUpstreamFallback(name, env);
  if (fallback && fallback !== primary && isLocalBase(primary)) {
    return [primary, fallback];
  }
  return [primary];
}

// ── Getters: thin lookups over the table. Signatures + return values are
// identical to before, so every importer (incl. the /api/health probe) is
// unaffected. ─────────────────────────────────────────────────────────────────
export function getStockPickerApiBase(env: NodeJS.ProcessEnv = process.env): string {
  return resolveUpstreamPrimary("STOCK_PICKER", env);
}
export function getNewsApiBase(env: NodeJS.ProcessEnv = process.env): string {
  return resolveUpstreamPrimary("NEWS", env);
}
export function getSmartnewsApiBase(env: NodeJS.ProcessEnv = process.env): string {
  return resolveUpstreamPrimary("SMARTNEWS", env);
}
export function getValuationApiBase(env: NodeJS.ProcessEnv = process.env): string {
  return resolveUpstreamPrimary("VALUATION", env);
}
export function getValuationFallbackBase(env: NodeJS.ProcessEnv = process.env): string {
  return resolveUpstreamFallback("VALUATION", env)!;
}
export function getPerformanceApiBase(env: NodeJS.ProcessEnv = process.env): string {
  return resolveUpstreamPrimary("PERFORMANCE", env);
}
export function getTrendingApiBase(env: NodeJS.ProcessEnv = process.env): string {
  return resolveUpstreamPrimary("TRENDING", env);
}
export function getCompetitiveApiBase(env: NodeJS.ProcessEnv = process.env): string {
  return resolveUpstreamPrimary("COMPETITIVE", env);
}
export function getFdaApiBase(env: NodeJS.ProcessEnv = process.env): string {
  return resolveUpstreamPrimary("FDA", env);
}
export function getRumorApiBase(env: NodeJS.ProcessEnv = process.env): string {
  return resolveUpstreamPrimary("RUMOR", env);
}
