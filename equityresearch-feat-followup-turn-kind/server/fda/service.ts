/**
 * FDA upstream fetch service. Extracted from routes/fda.ts (per-source service
 * split) — no behavior change. Both the Express routes (routes/fda.ts) and the
 * agent plan registry (agent/planRegistry.ts) call fetchFdaUpstream from here.
 */
import { resolveUpstreamBases } from "../upstreamConfig";
import { fetchJsonWithFallback } from "../upstreamFetch";

const FDA_PROXY_TIMEOUT_MS = 15000;

/** Proxy a path to the FDA upstream with local→public failover; data is opaque.
 *  Exported so the agent (planRegistry) fetches FDA via this same hardened client
 *  instead of a loopback self-call to the /fda/* route. */
export function fetchFdaUpstream(path: string): Promise<unknown> {
  return fetchJsonWithFallback(
    resolveUpstreamBases("FDA").map((base) => ({
      url: `${base}${path}`,
      init: {},
      parse: (raw: unknown) => raw,
    })),
    { timeoutMs: FDA_PROXY_TIMEOUT_MS, label: "FDA", errorTag: "FDA" },
  );
}

/** Trim the FDA payload for the LLM prompt. Extracted verbatim from
 *  generator.simplifyApiData — no behavior change. */
export function simplifyFda(data: any): any {
  const fdaData = data.data || data;
  const drugs = fdaData.drugs || [];
  return {
    company: fdaData.company,
    ticker: fdaData.ticker,
    totalEvents: fdaData.totalEvents || drugs.length,
    latestUpdate: fdaData.latestUpdate,
    drugs: drugs.slice(0, 5).map((item: any) => ({
      drug: item.drug?.substring(0, 100),
      indication: item.indication?.substring(0, 80),
      date: item.date,
      event: item.event?.substring(0, 150),
      status: item.status || item.eventDetails,
    })),
  };
}
