// Per-source projectors for the generic `source_card` channel: compact a
// structured card payload to ONE line of classifier-routing history. This registry
// grows as the HTML-card datasources migrate off backend formatters onto structured
// payloads (see docs/CARD_RENDER_MIGRATION_PLAN.md). Typed loosely (payload: any) so
// shared/ stays free of the client render types.

import { projectTrending, projectMarketData, projectStockPicker } from "./listProjection";
import { normalizeRumorPayload } from "./rumor/normalize";

type SourceCardProjector = (payload: any) => string;

const RATING_PROJECTOR: SourceCardProjector = (p) => {
  return [
    `RATING ${p?.ticker ?? ""}`.trim(),
    p?.rating ? `consensus ${p.rating}` : "",
    typeof p?.price === "number" ? `@ $${p.price.toFixed(2)}` : "",
    p?.valuation?.status ? `valuation ${p.valuation.status}` : "",
  ]
    .filter(Boolean)
    .join(" ");
};

const STOCK_PRICE_PROJECTOR: SourceCardProjector = (p) => {
  const price = p?.currentPrice?.price ?? p?.currentPrice;
  const pct = p?.currentPrice?.changePercent ?? p?.changePercent;
  return [
    `STOCK_PRICE ${p?.ticker ?? ""}`.trim(),
    typeof price === "number" ? `@ $${price.toFixed(2)}` : "",
    typeof pct === "number" ? `(${pct >= 0 ? "+" : ""}${pct.toFixed(2)}%)` : "",
  ]
    .filter(Boolean)
    .join(" ");
};

const VALUATION_PROJECTOR: SourceCardProjector = (p) => {
  const rec = p?.ai_recommendation ?? {};
  return [
    `VALUATION ${p?.ticker ?? ""}`.trim(),
    rec.decision ? String(rec.decision).toLowerCase() : "",
    typeof rec.chosen_price === "number" ? `fair $${rec.chosen_price.toFixed(2)}` : "",
    typeof p?.current_price === "number" ? `vs $${p.current_price.toFixed(2)}` : "",
    rec.upside_percentage != null ? `(${rec.upside_percentage}%)` : "",
  ]
    .filter(Boolean)
    .join(" ");
};

const PERFORMANCE_PROJECTOR: SourceCardProjector = (p) => {
  const ticker = p?.analysis?.ticker || p?.primaryTicker || "";
  const peers: string[] = p?.analysis?.peers || p?.peers || [];
  // The primary-company analysis is a JSON string holding a `rating` field.
  let rating = "";
  const raw = typeof p?.analysis?.analysis === "string" ? p.analysis.analysis.trim().replace(/^```json\s*|\s*```$/g, "") : "";
  if (raw.startsWith("{") && raw.endsWith("}")) {
    try {
      const r = JSON.parse(raw)?.rating;
      if (typeof r === "string") rating = r.trim();
    } catch {}
  }
  return [
    `PERFORMANCE ${ticker}`.trim(),
    peers.length ? `vs ${peers.join(", ")}` : "",
    rating ? `rated ${rating}` : "",
  ]
    .filter(Boolean)
    .join(" ");
};

const FDA_PROJECTOR: SourceCardProjector = (p) => {
  // payload is FdaResponse { success, data }; data is one company or an array.
  const inner = p?.data;
  if (Array.isArray(inner)) {
    const tickers = inner.map((c: any) => c?.ticker).filter(Boolean);
    return `FDA pipeline ${inner.length} companies${tickers.length ? ` (${tickers.join(", ")})` : ""}`.trim();
  }
  const drugs: any[] = inner?.drugs ?? [];
  return [
    `FDA ${inner?.ticker ?? ""}`.trim(),
    inner?.company ? inner.company : "",
    drugs.length ? `${drugs.length} pipeline events` : "no active submissions",
  ]
    .filter(Boolean)
    .join(" ");
};

// TRENDING / MARKET_DATA are list-type: their classifier line is the same
// budget-bounded list projection the html_card path used (shared/listProjection),
// so follow-up routing ("of these, which…") is unchanged after migration. Empty/
// failed payloads project to "" (nothing to route to).
const TRENDING_PROJECTOR: SourceCardProjector = (p) => projectTrending(p) ?? "";
const MARKET_DATA_PROJECTOR: SourceCardProjector = (p) => projectMarketData(p) ?? "";
const STOCK_PICKER_PROJECTOR: SourceCardProjector = (p) => projectStockPicker(p) ?? "";

const RUMOR_PROJECTOR: SourceCardProjector = (p) => {
  const r = normalizeRumorPayload(p);
  return [
    "RUMOR",
    r.rumor ? `"${r.rumor}"` : "",
    r.verdictLabel ? `verdict ${r.verdictLabel}` : "",
    r.confidence && r.confidence !== "Unknown" && r.confidence !== "未知" ? `confidence ${r.confidence}` : "",
  ]
    .filter(Boolean)
    .join(" ");
};

// EARNINGS is topic-discriminated; project identity + a short routable snippet of
// the answer/headings (bounded) so follow-ups ("what did they say about margins?")
// resolve from history. Narrative value is re-fetched when actually asked.
const EARNINGS_PROJECTOR: SourceCardProjector = (p) => {
  const snip = (s: unknown, n = 220) => (typeof s === "string" ? s.replace(/\s+/g, " ").trim().slice(0, n) : "");
  const ed = p?.data || p;
  const ticker = p?.ticker || ed?.ticker || "";
  const period = [p?.year || ed?.year, p?.quarter || ed?.quarter ? `Q${p?.quarter || ed?.quarter}` : ""].filter(Boolean).join(" ");
  const head = `EARNINGS ${ticker} ${period}`.replace(/\s+/g, " ").trim();

  if (p?.topic === "calendar") {
    const syms: string[] = Array.isArray(p?.calendar?.rows)
      ? p.calendar.rows.map((r: any) => r?.symbol).filter(Boolean)
      : Array.isArray(p?.days)
        ? p.days.flatMap((d: any) => (d?.companies || []).map((c: any) => c?.symbol)).filter(Boolean)
        : [];
    const frame = p?.range?.label || p?.date || "calendar";
    return `EARNINGS calendar ${frame}: ${syms.slice(0, 30).join(", ")}`.trim();
  }
  if (p?.topic === "multi_quarter_ask") {
    const qs: string[] = Array.isArray(p?.quarters) ? p.quarters.map((q: any) => String(q?.quarter)).filter(Boolean) : [];
    return `${head} multi-quarter: ${qs.join(", ")}`.trim();
  }
  if (p?.topic === "ask" || typeof ed?.answer === "string") return `${head} Q&A: ${snip(p?.answer ?? ed?.answer)}`.trim();
  const sections = Array.isArray(ed) ? ed : ed?.sections;
  if (Array.isArray(sections) && sections[0]?.heading) {
    return `${head} summary: ${sections.map((s: any) => s?.heading).filter(Boolean).slice(0, 8).join("; ")}`.trim();
  }
  if (ed?.transcript_split || ed?.transcript || ed?.participants) return `${head} transcript`.trim();
  return head;
};

// COMPETITIVE (Porter's Five Forces) folded onto source_card: no markdown body,
// so route on company/ticker + industry + overall assessment (same line the old
// COMPETITIVE_SPEC produced, kept identical so follow-up routing is unchanged).
const COMPETITIVE_PROJECTOR: SourceCardProjector = (c) => {
  if (!c) return "";
  const who = [c.company, c.ticker ? `(${c.ticker})` : ""].filter(Boolean).join(" ").trim();
  return [who ? `Competitive analysis: ${who}` : "Competitive analysis", c.industry, c.overall_assessment]
    .filter(Boolean)
    .join("\n");
};

/** source (e.g. "RATING") → projector. One entry per migrated source. */
export const SOURCE_CARD_PROJECTORS: Record<string, SourceCardProjector> = {
  RATING: RATING_PROJECTOR,
  STOCK_PRICE: STOCK_PRICE_PROJECTOR,
  VALUATION: VALUATION_PROJECTOR,
  PERFORMANCE: PERFORMANCE_PROJECTOR,
  FDA: FDA_PROJECTOR,
  TRENDING: TRENDING_PROJECTOR,
  MARKET_DATA: MARKET_DATA_PROJECTOR,
  RUMOR: RUMOR_PROJECTOR,
  EARNINGS: EARNINGS_PROJECTOR,
  COMPETITIVE: COMPETITIVE_PROJECTOR,
  STOCK_PICKER: STOCK_PICKER_PROJECTOR,
};

/** Compact a source_card payload to one classifier-history line ("" if unknown source). */
export function projectSourceCard(source: string, payload: any): string {
  const projector = SOURCE_CARD_PROJECTORS[source];
  return projector ? projector(payload) : "";
}
