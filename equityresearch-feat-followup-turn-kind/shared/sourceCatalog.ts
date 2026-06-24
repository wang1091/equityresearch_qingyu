// THE single source of truth for the data sources the agent can fetch, plus each
// one's default upstream timeout. Lives in shared/ (the lowest layer) so both
// strategy/ and server/ depend on it; nothing redefines this list. The server's
// intent whitelist (server/agent/intentSources.ts) re-exports SUPPORTED_DATA_SOURCES
// rather than keeping its own copy. Adding a source = add it here (+ its timeout).

export const SUPPORTED_DATA_SOURCES = [
  "STOCK_PRICE",
  "FDA",
  "VALUATION",
  "NEWS",
  "RUMOR",
  "EARNINGS",
  "PERFORMANCE",
  "COMPETITIVE",
  "PEER_STOCKS",
  "RATING",
  "TRENDING",
  "MARKET_DATA",
  "GENERAL",
  // Checkit multi-engine stock scoring / screening (sentiment + earnings +
  // financial + valuation → final score + buy/hold/sell). Covers explicit
  // stock-picker requests and bare multi-stock comparisons with no other lens.
  "STOCK_PICKER",
] as const;

export type SupportedDataSource = (typeof SUPPORTED_DATA_SOURCES)[number];

/**
 * Default per-source timeout (ms), mirroring the current agent-path values in
 * server/agent/apiCaller.ts. A plan builder may override via its policy. GENERAL
 * is a local (no-fetch) source, so its value is only a nominal floor.
 */
export const SOURCE_TIMEOUT_MS: Record<SupportedDataSource, number> = {
  STOCK_PRICE: 10_000,
  FDA: 10_000,
  VALUATION: 90_000,
  NEWS: 90_000,
  RUMOR: 110_000,
  EARNINGS: 120_000,
  PERFORMANCE: 120_000,
  COMPETITIVE: 60_000,
  PEER_STOCKS: 10_000,
  RATING: 15_000,
  TRENDING: 12_000,
  MARKET_DATA: 12_000,
  GENERAL: 5_000,
  // The actual per-fetch timeout for the stock-picker fan-out lives in
  // server/stockPicker/service.ts (STOCK_PICKER_TIMEOUT_MS = 120_000) — the
  // multi-engine score-off routinely takes 30–50s per ticker. Keep this nominal
  // value aligned with it so the catalog doesn't read as a 30s cap it never was.
  STOCK_PICKER: 120_000,
};
