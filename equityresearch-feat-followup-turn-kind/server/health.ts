/**
 * Upstream service health probe.
 *
 * .env is the single authority: every target is resolved through upstreamConfig
 * (the same resolvers the app uses to make its calls), so the health check probes
 * EXACTLY what the app talks to — no parallel hardcoded port table to drift.
 * Configure ports/URLs once in .env; both the app and this probe follow.
 *
 * Per-SERVICE reachability (one GET per upstream), not per-route functional tests:
 * any non-5xx response = up; a redirect = ⚠️ (you pointed it at an nginx domain,
 * not the backend port); 5xx / connection refused / timeout = down.
 *
 * Surfaced as a ✅/❌ table at boot (server/index.ts) and via GET /api/health.
 */
import {
  resolveUpstreamPrimary,
  resolveUpstreamFallback,
  type UpstreamName,
} from "./upstreamConfig";

export type ProbeStatus = "ok" | "warn" | "down" | "unconfigured";

export interface ProbeResult {
  name: string;
  critical: boolean;
  status: ProbeStatus;
  detail: string;
  ms: number;
}

const PROBE_TIMEOUT_MS = 5000;

interface Target {
  name: string;
  base: string;
  /** Path to probe (default "/"); use a real health path where one exists. */
  path?: string;
  critical?: boolean;
}

/** One probe spec per upstream — base(s) resolved from upstreamConfig (.env). */
interface ProbeSpec {
  name: string;
  upstream: UpstreamName;
  path?: string;
  critical?: boolean;
}

const PROBE_SPECS: ProbeSpec[] = [
  { name: "news (search)", upstream: "NEWS", path: "/api/health", critical: true },
  { name: "smartnews (earnings)", upstream: "SMARTNEWS", path: "/api/health", critical: true },
  { name: "stockpick", upstream: "STOCK_PICKER" },
  { name: "trending", upstream: "TRENDING" },
  { name: "valuation", upstream: "VALUATION", path: "/api/health" },
  { name: "keymetrics/performance", upstream: "PERFORMANCE", path: "/api/health" },
  { name: "competitive", upstream: "COMPETITIVE" },
  { name: "fda-calendar", upstream: "FDA" },
  { name: "rumorcheck", upstream: "RUMOR" },
];

/**
 * Every upstream the app calls — each base comes from upstreamConfig (.env).
 * With `includeFailover`, each upstream that has a distinct public failover
 * (nginx domain) gets a SECOND, non-critical "[nginx]" target so a host audit
 * can tell a dead local port from a broken nginx vhost independently.
 */
function targets(includeFailover = false): Target[] {
  const out: Target[] = [];
  for (const spec of PROBE_SPECS) {
    const primary = resolveUpstreamPrimary(spec.upstream);
    out.push({ name: spec.name, base: primary, path: spec.path, critical: spec.critical });
    if (includeFailover) {
      const fallback = resolveUpstreamFallback(spec.upstream);
      if (fallback && fallback !== primary) {
        // A failover host being down is not itself critical (primary is the
        // main path) — surfaced as degraded, not critical.
        out.push({ name: `${spec.name} [nginx]`, base: fallback, path: spec.path, critical: false });
      }
    }
  }
  return out;
}

/** GET the target (no redirect-follow) and classify the response. */
async function httpProbe(t: Target): Promise<ProbeResult> {
  const url = `${t.base}${t.path ?? "/"}`;
  const started = Date.now();
  try {
    const res = await fetch(url, {
      method: "GET",
      redirect: "manual",
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
    const ms = Date.now() - started;
    const isRedirect = res.type === "opaqueredirect" || (res.status >= 300 && res.status < 400);
    if (isRedirect) {
      return { name: t.name, critical: !!t.critical, status: "warn", detail: `${url} → redirect (point .env at the backend port, not the nginx domain)`, ms };
    }
    if (res.status >= 500) {
      return { name: t.name, critical: !!t.critical, status: "down", detail: `${url} → HTTP ${res.status}`, ms };
    }
    return { name: t.name, critical: !!t.critical, status: "ok", detail: `${url} → HTTP ${res.status}`, ms };
  } catch (e) {
    const ms = Date.now() - started;
    return { name: t.name, critical: !!t.critical, status: "down", detail: `${url} → ${e instanceof Error ? e.message : String(e)}`, ms };
  }
}

/** Probe every upstream in parallel, plus the DeepSeek key (config-only).
 *  Pass `{ includeFailover: true }` to ALSO probe each upstream's public
 *  nginx failover base (for a standalone host audit, e.g. scripts/probe-hosts.ts). */
export async function probeUpstreams(
  opts: { includeFailover?: boolean } = {},
): Promise<ProbeResult[]> {
  const deepseekKey = !!(process.env.DEEPSEEK_API_KEY || process.env.DEEPSEEK_KEY);
  const deepseek: ProbeResult = {
    name: "deepseek (classifier)",
    critical: true,
    status: deepseekKey ? "ok" : "unconfigured",
    detail: deepseekKey ? "DEEPSEEK_API_KEY set" : "DEEPSEEK_API_KEY missing",
    ms: 0,
  };
  const http = await Promise.all(targets(opts.includeFailover).map(httpProbe));
  return [deepseek, ...http];
}

const ICON: Record<ProbeStatus, string> = { ok: "✅", warn: "⚠️", down: "❌", unconfigured: "⚪" };

export function summarizeHealth(results: ProbeResult[]) {
  const criticalDown = results.some((r) => r.critical && (r.status === "down" || r.status === "unconfigured"));
  const degraded = results.some((r) => r.status !== "ok");
  return {
    status: criticalDown ? "critical" : degraded ? "degraded" : "ok",
    criticalDown,
    degraded,
    services: results,
  };
}

export function formatHealthLines(results: ProbeResult[]): string[] {
  return results.map(
    (r) => `   ${ICON[r.status]} ${r.name.padEnd(26)} ${r.status.padEnd(12)} ${r.detail}${r.ms ? ` (${r.ms}ms)` : ""}`,
  );
}
