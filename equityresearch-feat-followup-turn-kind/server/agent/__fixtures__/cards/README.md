# Card fixtures

Golden inputs for the `cardFormatter` snapshot tests. Each file is the exact
`apiData` (plus `dataSource` + `language`) that `formatDataAsCard` received for
one card type, captured live. They are the safety net for splitting
`server/agent/cardFormatter.ts` into per-source modules: snapshot the rendered
HTML from these inputs before the split, assert it's byte-identical after.

## File shape

```json
{ "dataSource": "MARKET_DATA", "language": "en", "apiData": { ... } }
```

Filename: `<DATA_SOURCE>[_<topic>]_<lang>.json` (topic only for EARNINGS).

## Regenerate

The capture facility lives in `server/agent/cardFixtures.ts` (env-gated, no-op
in normal operation). Two terminals:

```bash
# 1) boot the server with capture on (note the printed port, e.g. :5003)
DUMP_CARD_FIXTURES=1 npm run dev

# 2) fire the query battery at that port
BASE_URL=http://127.0.0.1:5003 npm run fixtures:cards
```

Needs `DEEPSEEK_API_KEY` (live classifier). A card type is only written if its
single-intent direct-card path is reached.

## Coverage (2026-06-16)

Every live formatter now has a golden input (all verified to render a real
card, not the error fallback).

**Captured live (real upstream data):**
`MARKET_DATA` (en/zh) · `STOCK_PRICE` (en/zh) · `RATING` (en/zh) ·
`VALUATION` (en) · `EARNINGS` ask/calendar/qa/summary/transcript.

**Hand-built (`"_synthetic"` field; upstream not in this checkout):**
`FDA` (en) · `PERFORMANCE` (en) · `RUMOR` (en). Shapes mirror each formatter's
expected input; replace with live captures once the upstreams are reachable.

**Error branch:** `TRENDING` (en) — upstream :5656 down; TRENDING renders a
card on failure too, so this exercises that path.

**Intentionally absent — `NEWS` / `COMPETITIVE`:** those single-intent paths
stream structured `news_v2` / `competitive` payloads via `onPayload` and never
reach `formatDataAsCard`; the HTML formatters are the no-onPayload fallback (see
the NOTE comments in cardFormatter.ts). Not capturable here and not needed.

**Not yet covered (minor EARNINGS topics):** transcript_qa / multiQuarter /
next — capture later if the split touches those sub-formatters.
