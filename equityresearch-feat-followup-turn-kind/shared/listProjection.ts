// List-turn → classifier-history projection (shared). Compacts a list-shaped card
// result (TRENDING / MARKET_DATA / STOCK_PICKER) into ONE line carrying just the
// identity + the list's defining axis, so a follow-up like "这些里哪只…/of these"
// can resolve the SET from the 400-char classifier history instead of an HTML card
// whose first 400 chars are markup. See docs/HISTORY_PROJECTION_PLAN.md.
//
// Moved here from server/agent/historyProjection.ts so the generic source_card
// channel (shared/sourceCard.ts) and the server's html_card path project list
// turns through ONE implementation — the migrated TRENDING/MARKET_DATA cards must
// emit the SAME classifier line as before or follow-up routing regresses.
//
// Field choice rule: keep iff it is identity (ticker/companyName) or the list's
// ONE defining axis (changePercent for a gainers list, finalScore+recommendation
// for a score-off). Everything else is an "answer value" — dropped; the classifier
// only needs to ROUTE, the value is re-fetched when actually asked.
//
// NOTE: reads RAW upstream payloads (the persistence point runs before simplify).
//
// turn_kind Phase 4b-0: the LIST CONTENTS (which items, in what order, with what
// metric) now come from extractListSnapshot — the SAME extractor computed RECALL /
// DRILL_IN read (docs/TURN_KIND_PHASE_4B_PLAN.md §1.3: "计算与投影同源"). The text
// frame ([TRENDING top_gainers @date]) stays here — it is a lossy label, not data.
// The STOCK_PICKER comparison/score branch still reads raw `results` directly: its
// axis includes `recommendation`, a categorical value that is not a ListItem metric.

import { extractListSnapshot, type ListItem } from "./listSnapshot";

const MAX_LINE = 380; // stay under the classifier's 400-char/turn cap
const NAME_CAP = 16; // truncate companyName to keep refs ("做超声那家") without blowing budget
const MORE_RESERVE = 12; // room reserved for a trailing " (+N more)"

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n) : s;
}

/** raw changePercent is a NUMBER (the "%" is added by simplify, not upstream). */
function fmtPct(v: unknown): string {
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n)) return "";
  return `${n >= 0 ? "+" : ""}${n.toFixed(2)}%`;
}

/** `TICKER/Company Name +12.34%` from a typed ListItem (changePercent is already a
 *  finite number | null) — shared by trending + stock-picker trending mode. */
function gainerLine(item: ListItem): string {
  if (!item.ticker) return "";
  const name = truncate(item.name || "", NAME_CAP);
  const cp = item.metrics.changePercent;
  const pct = cp == null ? "" : fmtPct(cp);
  return [item.ticker, name].filter(Boolean).join("/") + (pct ? ` ${pct}` : "");
}

/** Join frame + items into one budget-bounded line; overflow → ` (+N more)`. */
export function assemble(frame: string, rawItems: string[]): string | null {
  const items = rawItems.filter(Boolean);
  if (items.length === 0) return null;
  const head = `[${frame}] `;
  const kept: string[] = [];
  let len = head.length;
  for (const it of items) {
    const add = (kept.length ? 2 : 0) + it.length; // "; " separator
    if (kept.length > 0 && len + add > MAX_LINE - MORE_RESERVE) break;
    kept.push(it);
    len += add;
  }
  const remaining = items.length - kept.length;
  let line = head + kept.join("; ");
  if (remaining > 0) line += ` (+${remaining} more)`;
  return line;
}

export function projectTrending(payload: any): string | null {
  // Items + order from the shared extractor; the [TRENDING <id> @<date>] frame is a
  // label kept here. extractor → first non-empty view (== the old first-with-stocks).
  const snapshot = extractListSnapshot("TRENDING", payload);
  const view = snapshot?.views[0];
  if (!view) return null;
  const asOf = view.context?.asOf ? ` @${view.context.asOf}` : "";
  return assemble(`TRENDING ${view.id}${asOf}`, view.items.map(gainerLine));
}

export function projectStockPicker(payload: any): string | null {
  const results: any[] = Array.isArray(payload?.results) ? payload.results : [];
  const labels: string[] = Array.isArray(payload?.labels) ? payload.labels : [];

  // trending/screener mode: the real list is nested in results[0].category.stocks,
  // NOT in results (which is length 1 here). Items from the shared extractor (its
  // STOCK_PICKER trending adapter reads the same nested set); view.id == "trending <cat>".
  if (payload?.mode === "trending") {
    const view = extractListSnapshot("STOCK_PICKER", payload)?.views[0];
    if (!view) return null;
    return assemble(`STOCK_PICKER ${view.id}`, view.items.map(gainerLine));
  }

  // comparison / single (score-off): axis = finalScore + recommendation. Read raw —
  // recommendation is categorical (not a ListItem metric), so this branch is the one
  // lossy projection NOT routed through the extractor (see file header).
  if (results.length === 0) return null;
  const items = results.map((r, i) => {
    const t = labels[i] || r?.ticker;
    if (!t) return "";
    const rec = r?.recommendation ? ` ${r.recommendation}` : "";
    const score = typeof r?.finalScore === "number" ? ` ${r.finalScore}` : "";
    return `${t}${rec}${score}`;
  });
  return assemble(`STOCK_PICKER ${payload?.mode || "score"}`, items);
}

export function projectMarketData(payload: any): string | null {
  if (payload?.success === false) return null;
  const quotes: any[] = Array.isArray(payload?.quotes) ? payload.quotes : [];
  if (quotes.length === 0) return null;
  const asOf = typeof payload?.fetchedAt === "string" ? ` @${payload.fetchedAt.slice(0, 10)}` : "";
  // No per-item axis: MARKET_DATA always fetches the caller's explicit ticker set
  // (not a ranked leaderboard) — identity only. queryType is the lens/frame.
  const items = quotes.map((q) => {
    const t = q?.ticker;
    if (!t) return "";
    return [t, truncate(String(q?.companyName || ""), NAME_CAP), q?.sector || ""]
      .filter(Boolean)
      .join("/");
  });
  return assemble(`MARKET_DATA ${payload?.queryType || "general"}${asOf}`, items);
}
