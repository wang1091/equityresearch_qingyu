/**
 * Stock Picker server module — talks to the upstream scoring service and shapes
 * its (LLM-generated, untrusted) responses for the agent pipeline.
 *
 *  - fetchStockPickerCard: fan out per ticker, validate every response, build the
 *    StockPickerCardPayload streamed to the frontend (single-intent direct card).
 *  - simplifyStockPicker: compact the same data for the generator (composite intent).
 */
import { logger } from "../utils";
import { resolveUpstreamBases } from "../upstreamConfig";
import { fetchJsonWithFallback } from "../upstreamFetch";
import {
  parseStockPickerResponse,
  hasRenderableContent,
  type StockPickerResponse,
  type StockPickerCardPayload,
  type StockPickerRenderMode,
} from "../../shared/stockPicker";

const STOCK_PICKER_TIMEOUT_MS = 120000; // 2 min — multi-engine score-off can be slow

export interface StockPickerParams {
  tickers?: unknown;
  query?: unknown;
  category?: unknown;
  lang?: unknown;
}

/**
 * Call the upstream Stock Picker for one ticker, or for a screened list when no
 * anchor ticker is given. Returns a validated card payload, or throws when every
 * upstream call fails/validates-empty (so the caller falls back to the LLM stream).
 */
export async function fetchStockPickerCard(
  params: StockPickerParams,
  logLabel = "STOCK_PICKER",
): Promise<StockPickerCardPayload> {
  const startTime = Date.now();
  const lang: "en" | "zh" = params.lang === "zh" ? "zh" : "en";
  const query: string = typeof params.query === "string" ? params.query : "";
  const tickers: string[] = Array.isArray(params.tickers)
    ? params.tickers.map((t: unknown) => String(t).toUpperCase().trim()).filter(Boolean)
    : [];
  const category: string = typeof params.category === "string" ? params.category.trim() : "";

  // One upstream body per ticker; or a single screened-list call when there is no
  // anchor ticker (category screen).
  const bodies: Array<Record<string, unknown>> = tickers.length
    ? tickers.map((ticker) => ({ ticker, ...(query ? { query } : {}), lang }))
    : [{ ...(category ? { category } : {}), ...(query ? { query } : {}), lang }];

  // Per-ticker fan-out. Each body fails over local→public via the shared loop;
  // validation lives INSIDE parse so a schema-invalid / empty 200 rejects that
  // attempt (and falls through to the public base) instead of being trusted.
  const bases = resolveUpstreamBases("STOCK_PICKER");
  const settled = await Promise.all(
    bodies.map(async (body, i) => {
      try {
        const result = await fetchJsonWithFallback<StockPickerResponse>(
          bases.map((base) => ({
            url: `${base}/api/stock-picker/query`,
            init: {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(body),
            },
            parse: (raw: unknown) => {
              const parsed = parseStockPickerResponse(raw);
              if (!parsed.ok) throw new Error(`response validation failed: ${parsed.error}`);
              if (!hasRenderableContent(parsed.value)) throw new Error("response has no renderable content");
              return parsed.value;
            },
          })),
          {
            timeoutMs: STOCK_PICKER_TIMEOUT_MS,
            label: `${logLabel}[${i}]`,
            errorTag: "STOCK_PICKER",
            // 30s timeout endpoint with cross-URL failover — a timeout retry
            // would ~2x the wait, so rely on failover (as NEWS/VALUATION).
            maxRetries: 0,
          },
        );
        return { result, label: tickers[i] || query };
      } catch (err) {
        logger.warn(
          `⚠️ ${logLabel} 上游不可达/校验失败[${i}]: ${err instanceof Error ? err.message : String(err)}`,
        );
        return null;
      }
    }),
  );

  const valid = settled.filter(
    (x): x is { result: StockPickerResponse; label: string } => x !== null,
  );
  if (valid.length === 0) {
    throw new Error("STOCK_PICKER: no usable upstream response");
  }

  const isTrending = valid.length === 1 && valid[0].result.intent === "trending";
  const mode: StockPickerRenderMode =
    isTrending ? "trending" : valid.length >= 2 ? "comparison" : "single";

  // The fan-out is parallel + per-ticker (settled[i] is null when ticker[i]'s call
  // failed/validated-empty). Surface the requested-but-dropped tickers so the card can
  // tell the user a name couldn't be scored — a flaky upstream commonly returns one
  // ticker of a comparison but not the other, which otherwise looks like a single result.
  const droppedTickers = tickers.filter((_, i) => settled[i] === null);

  const payload: StockPickerCardPayload = {
    mode,
    language: lang,
    query,
    results: valid.map((v) => v.result),
    // Prefer the upstream-resolved ticker, fall back to the label we sent.
    labels: valid.map((v) => v.result.ticker || v.label),
    ...(droppedTickers.length ? { droppedTickers } : {}),
  };
  logger.info(
    `  ✓ ${logLabel} mode=${mode} n=${valid.length}${droppedTickers.length ? ` dropped=${droppedTickers.join(",")}` : ""} (${Date.now() - startTime}ms)`,
  );
  return payload;
}

/**
 * Compact a StockPickerCardPayload for the generator (composite-intent path only):
 * just the salient verdict fields so it can weave the score into prose — not the
 * full breakdown text.
 */
export function simplifyStockPicker(data: any): Record<string, any> {
  const results: StockPickerResponse[] = Array.isArray(data?.results) ? data.results : [];
  const labels: string[] = Array.isArray(data?.labels) ? data.labels : [];
  return {
    mode: data?.mode,
    stocks: results.map((r, i) => ({
      name: labels[i] || r?.ticker,
      finalScore: r?.finalScore,
      recommendation: r?.recommendation,
      confidence: r?.confidence,
      scores: {
        sentiment: r?.sentimentScore,
        earnings: r?.earningsScore,
        financial: r?.financialScore,
        valuation: r?.valuationScore,
      },
      keyDrivers: r?.sentimentBreakdown?.key_drivers?.slice(0, 3),
      keyRisks: r?.earningsBreakdown?.key_risks?.slice(0, 3),
    })),
  };
}
