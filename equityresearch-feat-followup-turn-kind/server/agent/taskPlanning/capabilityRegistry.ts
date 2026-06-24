// server/agent/taskPlanning/capabilityRegistry.ts
//
// CAPABILITY_REGISTRY (doc §4.2): metric family → ordered list of sources that can
// answer it, preferred first. This is the DETERMINISTIC home for "which source owns
// which metric" — it replaces scattering that knowledge across prompt examples
// ([[llm-ts-boundary-principle]]: capability matching is TS, not the LLM's job).
//
// DELIBERATELY NARROW (doc §392): the v1 registry covers ONLY the families whose
// capability edge the §11 matrix / Phase 0.5 KPI reroute actually proved. The other
// families (market/valuation/news) are intentionally ABSENT — a `Partial` map — so an
// unregistered family fails closed (validateTasks → unsupported_metric_source, no
// FetchStep) instead of pretending a physical plan we can't yet build. Adding a
// family here is gated on building its real param path (the Phase 3 adapter), not on
// the metric existing. Adding a provider = add a row; QueryTask semantics and the
// prompt do not change (doc §9.1 / §13.3 — operating_kpi is EARNINGS/transcript_qa
// only because that is today's physical RAG home, not a permanent truth).

import type { DataSource } from "../intentSources";
import type { MetricFamily } from "./types";

export interface Capability {
  source: DataSource;
  /** EARNINGS sub-topic, when the source needs one (transcript_qa for RAG). */
  topic?: string;
  /** Higher = preferred; lower entries are runtime fallbacks for the same family. */
  priority: number;
}

export const CAPABILITY_REGISTRY: Partial<Record<MetricFamily, Capability[]>> = {
  // Operating KPIs (members / subscribers / MAU / stores / deliveries / ARPU …) are
  // NOT statement fields → never PERFORMANCE. Today's physical home is transcript_qa
  // RAG (which also indexes 10-K/10-Q/releases). [[performance-semantic-boundary]]
  operating_kpi: [{ source: "EARNINGS", topic: "transcript_qa", priority: 10 }],

  // Standard financial-statement fields and their financial derivations.
  statement_metric: [{ source: "PERFORMANCE", priority: 10 }],

  // Management's spoken commentary / positioning / read-through.
  management_commentary: [{ source: "EARNINGS", topic: "transcript_qa", priority: 10 }],

  // market_metric / valuation_metric / news_event: NOT registered yet — see header.
};

/** Capabilities for a family, preferred (highest priority) first. */
export function capabilitiesFor(family: MetricFamily): Capability[] {
  return [...(CAPABILITY_REGISTRY[family] ?? [])].sort((a, b) => b.priority - a.priority);
}

/** Whether `source` can answer `family` at all (the plan-time capability guard, §8.1). */
export function isSourceSupported(family: MetricFamily, source: DataSource): boolean {
  return capabilitiesFor(family).some((c) => c.source === source);
}
