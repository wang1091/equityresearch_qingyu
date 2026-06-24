// PERFORMANCE data source — quarterly financial metrics for a ticker + peers.
//
// Extracted from the apiCaller switch (it was the heaviest inline case) into its
// own module, mirroring server/earnings/. The flow is a 4-step upstream chain,
// all against the local performance service ($LOCAL/api/performance/*):
//   1. company-analysis  (Yahoo-backed qualitative text + peers) — non-fatal
//   2. find-peers        (fallback peer resolution if step 1 gave none) — non-fatal
//   3. get-metrics       (the core historical time-series) — FATAL if it fails
//   4. peer-analysis     (keymetrics-style conclusion takeaway) — non-fatal
import { logger } from "../utils";
import { getLocalApiBase } from "../localApi";

/**
 * Fetch the PERFORMANCE payload (analysis + peers + metrics + peerConclusion).
 * Throws only when the core get-metrics step fails; the qualitative/peer/
 * conclusion steps are best-effort so the card still renders on partial data.
 */
export async function fetchPerformanceData(
  params: Record<string, any>,
  logLabel = "PERFORMANCE",
): Promise<any> {
  const startTime = Date.now();
  const localApiBase = getLocalApiBase();

  const primaryTicker = params.ticker || params.tickers?.[0];
  if (!primaryTicker) {
    throw new Error("PERFORMANCE: Missing ticker parameter");
  }

  // User-named comparables: when the turn carries 2+ tickers (a comparison like
  // "AMD vs INTC"), tickers[1..] are the peers the user explicitly asked for.
  // Honor them instead of auto-resolving — previously these were silently
  // dropped (only tickers[0] was used), turning "AMD vs INTC" into "AMD vs its
  // auto-peers". Single-ticker turns leave this empty → auto-resolution below.
  const primaryUpper = String(primaryTicker).toUpperCase().trim();
  const explicitPeers: string[] = Array.isArray(params.tickers)
    ? [...new Set(
        params.tickers
          .slice(1)
          .map((t: any) => String(t).toUpperCase().trim())
          .filter((t: string) => t && t !== primaryUpper),
      )]
    : [];

  const perfParams = new URLSearchParams({
    ticker: primaryTicker,
    lang: params.lang || "en",
  });
  // Multi-ticker comparison → use the user's peers throughout (the upstream
  // primary-company-analysis accepts ?peers=). This keeps the qualitative
  // narrative aligned with the metrics table and skips peer auto-detection.
  if (explicitPeers.length) {
    perfParams.set("peers", explicitPeers.join(","));
  }

  // Optionally fetch company analysis (qualitative text + peers).
  // Calls Yahoo Finance — can hit rate limits, so treat as non-fatal.
  let analysisData: any = null;
  try {
    const analysisRes = await fetch(
      `${localApiBase}/api/performance/company-analysis?${perfParams}`,
      { method: "GET", signal: AbortSignal.timeout(15000) },
    );
    if (analysisRes.ok) {
      analysisData = await analysisRes.json();
    } else {
      logger.warn(`⚠️ company-analysis returned ${analysisRes.status} — will try find-peers fallback`);
    }
  } catch {
    logger.warn("⚠️ company-analysis fetch failed — will try find-peers fallback");
  }

  // Resolve peer tickers: explicit user-named peers win; else from analysis;
  // else call find-peers.
  let peerTickers: string[] = explicitPeers.length ? explicitPeers : (analysisData?.peers || []);
  if (peerTickers.length === 0) {
    try {
      const peersRes = await fetch(
        `${localApiBase}/api/performance/find-peers`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ticker: primaryTicker }),
          signal: AbortSignal.timeout(10000),
        },
      );
      if (peersRes.ok) {
        const peersData = await peersRes.json();
        // peers can be strings OR objects {name, ticker} depending on API version
        const rawPeers: any[] = Array.isArray(peersData.peers) ? peersData.peers : [];
        peerTickers = rawPeers.slice(0, 3).map((p: any) =>
          typeof p === "string" ? p : (p.ticker || p.name || "")
        ).filter(Boolean);
        logger.info(`📊 find-peers fallback: ${peerTickers.join(", ")}`);
      }
    } catch {
      logger.warn("⚠️ find-peers fallback failed — single-ticker metrics only");
    }
  }

  // Fetch metrics for primary ticker + peers (the core historical time-series data).
  const allTickers = [primaryTicker, ...peerTickers];
  const metricsRes = await fetch(
    `${localApiBase}/api/performance/get-metrics`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tickers: allTickers }),
      signal: AbortSignal.timeout(18000),
    },
  );

  if (!metricsRes.ok) {
    throw new Error(`get-metrics failed: ${metricsRes.status}`);
  }

  const metricsData = await metricsRes.json();

  // Build the keymetrics-style conclusion payload and fetch the
  // "Primary Company Analysis" takeaway text. Non-fatal: if it fails
  // the card simply falls back to whatever analysisData provided.
  let peerConclusion: { en?: string; zh?: string; period?: string } | null = null;
  try {
    const validTickers = allTickers.filter(
      (t) => metricsData?.[t] && !metricsData[t].error,
    );
    if (validTickers.length >= 2) {
      const primaryMetrics = metricsData[primaryTicker] || {};
      const rev = primaryMetrics["Total Revenue"];
      const quarters = rev && typeof rev === "object"
        ? Object.keys(rev).filter((k) => k !== "Current").sort().slice(-5)
        : [];
      const period = quarters[quarters.length - 1];

      if (period) {
        const lqMetrics = [
          "Market Cap", "Total Revenue", "Gross Margin %",
          "Operating Expense", "EBIT", "Net Income", "Free Cash Flow",
        ];
        const lq_rows = lqMetrics.map((metric) => {
          const row: Record<string, any> = { metric };
          for (const t of validTickers) {
            const key = metric === "Market Cap" ? "Current" : period;
            const v = (metricsData[t] as any)?.[metric]?.[key];
            row[t] = v === undefined ? null : v;
          }
          return row;
        });

        const tsMetrics = [
          "Total Revenue", "Gross Margin %", "Operating Expense",
          "EBIT", "Net Income", "Free Cash Flow",
        ];
        const ts_rows = tsMetrics.map((metric) => ({
          metric,
          values: quarters.map((q) => {
            const v = (primaryMetrics as any)?.[metric]?.[q];
            return v === undefined ? null : v;
          }),
        }));

        const conclusionRes = await fetch(
          `${localApiBase}/api/performance/peer-analysis`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              primary: primaryTicker,
              latest_quarter: { period, rows: lq_rows },
              time_series: { ticker: primaryTicker, quarters, rows: ts_rows },
            }),
            signal: AbortSignal.timeout(25000),
          },
        );
        if (conclusionRes.ok) {
          const cd = await conclusionRes.json();
          peerConclusion = {
            en: (cd.conclusion_en || cd.conclusion || "").trim() || undefined,
            zh: (cd.conclusion_zh || "").trim() || undefined,
            period: cd.period,
          };
        } else {
          logger.warn(`⚠️ peer-analysis returned ${conclusionRes.status}`);
        }
      }
    }
  } catch (err) {
    logger.warn(`⚠️ peer-analysis fetch failed: ${err instanceof Error ? err.message : String(err)}`);
  }

  // Always include primaryTicker and peers so cardFormatter can use them
  // even when analysis (from Yahoo Finance) is unavailable due to rate limits.
  const data = {
    ...(analysisData ? { analysis: analysisData } : {}),
    primaryTicker,
    peers: peerTickers,
    metrics: metricsData,
    ...(peerConclusion ? { peerConclusion } : {}),
  };

  logger.info(`  ✓ ${logLabel} (${Date.now() - startTime}ms)`);
  return data;
}

/** Trim the PERFORMANCE payload for the LLM prompt. */
export function simplifyPerformance(data: any): any {
  // data.analysis is the full response object from /api/performance/company-analysis:
  // { ticker, period, analysis: "<text>", peers: [...], ... }
  const analysisObj = data.analysis;
  const rawAnalysis: string =
    typeof analysisObj === "string"
      ? analysisObj
      : (typeof analysisObj?.analysis === "string" ? analysisObj.analysis : "");

  // Upstream primary-company-analysis now emits a STRUCTURED JSON object
  // ({rating, summary, financial_performance, peer_comparison_rank,
  // valuation_ratios}) — see formatters/performance.ts. The old "►► PEER
  // COMPARISON:" prose regex never matches it, so the previous code always fell
  // to substring(0,800), feeding the LLM a JSON blob truncated mid-object and
  // dropping the rating entirely. Parse it directly; only free-form prose (legacy
  // / fallback) takes the truncation path, now with a more generous budget.
  let structuredAnalysis: Record<string, any> | null = null;
  let analysisText = "";
  const trimmed = rawAnalysis.trim().replace(/^```json\s*|\s*```$/g, "");
  if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
    try {
      const obj = JSON.parse(trimmed);
      if (obj && typeof obj === "object" && !Array.isArray(obj)) {
        const take = (v: any) =>
          Array.isArray(v) ? v.map((x: any) => String(x)).slice(0, 6) : undefined;
        structuredAnalysis = {
          ...(typeof obj.rating === "string" ? { rating: obj.rating } : {}),
          ...(take(obj.summary) ? { summary: take(obj.summary) } : {}),
          ...(take(obj.financial_performance) ? { financialPerformance: take(obj.financial_performance) } : {}),
          ...(take(obj.peer_comparison_rank) ? { peerComparisonRank: take(obj.peer_comparison_rank) } : {}),
          ...(take(obj.valuation_ratios) ? { valuationRatios: take(obj.valuation_ratios) } : {}),
        };
      }
    } catch {
      /* not valid JSON — fall through to prose truncation */
    }
  }
  if (!structuredAnalysis) {
    analysisText = rawAnalysis.length > 2000 ? rawAnalysis.substring(0, 2000) : rawAnalysis;
  }

  // keymetrics bilingual peer takeaway — used by the card formatter, previously
  // dropped here entirely.
  const peerTakeaway: string | undefined =
    data.peerConclusion?.en || data.peerConclusion?.zh || undefined;

  // Extract multi-quarter time series from keymetrics get-metrics response
  const rawMetrics = data.metrics || null;
  let quarterlyTimeSeries: Record<string, any> | null = null;
  if (rawMetrics && typeof rawMetrics === "object") {
    // Use primaryTicker as the key to look up; fall back to first key in metrics map
    const metricsKey = data.primaryTicker || Object.keys(rawMetrics)[0];
    if (metricsKey) {
      const tm = rawMetrics[metricsKey] as Record<string, any>;
      const TIME_SERIES_KEYS = [
        "Total Revenue", "Operating Expense", "EBIT", "Net Income",
        "Free Cash Flow", "Operating Cash Flow", "Gross Margin %",
        "P/E Ratio", "Price/Sales",
      ];
      quarterlyTimeSeries = {};
      for (const key of TIME_SERIES_KEYS) {
        if (tm[key] && typeof tm[key] === "object") {
          const entries = Object.entries(tm[key])
            .filter(([k]) => k !== "Current")
            .sort(([a], [b]) => a.localeCompare(b))
            .slice(-5); // last 5 quarters
          if (entries.length > 0) {
            quarterlyTimeSeries[key] = Object.fromEntries(entries);
          }
        }
      }
      if (Object.keys(quarterlyTimeSeries).length === 0) quarterlyTimeSeries = null;
    }
  }

  // Latest-quarter comparison across primary + peers. Without this the LLM saw
  // only the PRIMARY's series plus a delta-only takeaway and inverted the
  // direction (read "AMD 52.8% vs INTC 39.4%" as "INTC higher"). Give it each
  // peer's ABSOLUTE values at that peer's OWN latest reported quarter — the same
  // per-ticker convention the card's PeerComparisonTable uses (latestQuarterFor)
  // — so offset-fiscal peers (e.g. NVDA vs AMD) still contribute real numbers.
  // Each row carries its own `period` so the LLM knows which quarter it reads.
  let peerComparison: Record<string, any> | null = null;
  if (rawMetrics && typeof rawMetrics === "object" && Array.isArray(data.peers) && data.peers.length > 0) {
    const COMPARE_KEYS = [
      "Market Cap", "Total Revenue", "Gross Margin %", "Operating Expense",
      "EBIT", "Net Income", "Operating Cash Flow", "Free Cash Flow",
      "P/E Ratio", "Price/Sales",
    ];
    const latestQuarterFor = (tm: Record<string, any>): string | undefined => {
      const rev = tm["Total Revenue"];
      if (!rev || typeof rev !== "object") return undefined;
      const qs = Object.keys(rev).filter((k) => k !== "Current").sort();
      return qs[qs.length - 1];
    };
    const rows: Record<string, any> = {};
    for (const t of [data.primaryTicker, ...data.peers]) {
      const tm = rawMetrics[t] as Record<string, any>;
      if (!tm || typeof tm !== "object" || tm.error) continue;
      const q = latestQuarterFor(tm);
      const row: Record<string, any> = {};
      if (q) row.period = q;
      for (const key of COMPARE_KEYS) {
        const series = tm[key];
        const at = key === "Market Cap" ? "Current" : q;
        if (series && typeof series === "object" && at && series[at] !== undefined) {
          row[key] = series[at];
        }
      }
      if (Object.keys(row).some((k) => k !== "period")) rows[t] = row;
    }
    // Need the primary + at least one peer with real data to be a comparison.
    if (Object.keys(rows).length >= 2) peerComparison = rows;
  }

  return {
    ticker: data.primaryTicker ?? analysisObj?.ticker,
    period: analysisObj?.period,
    peers: data.peers,
    analysis: structuredAnalysis ?? analysisText,
    ...(peerTakeaway ? { peerTakeaway } : {}),
    ...(quarterlyTimeSeries ? { quarterlyTimeSeries } : {}),
    ...(peerComparison ? { peerComparison } : {}),
  };
}
