/**
 * Express routes for the Performance API proxy. Registered on the API router by
 * routes.ts (mirrors registerStockPickerRoutes). Proxies to the Python/Flask
 * performance service with clear 503/502 errors when it is down or returns HTML.
 *
 * Extracted verbatim from routes.ts (per-domain split) — no behavior change.
 * Behavior is pinned by server/routes/performance.test.ts.
 */
import type { Router, Response } from "express";
import { logger, SERVER_CONFIG } from "../utils";
import { getPerformanceApiBase, resolveUpstreamBases } from "../upstreamConfig";
import { fetchJsonWithFallback, UpstreamFallbackError } from "../upstreamFetch";

export function registerPerformanceRoutes(apiRouter: Router): void {
  // ========== Performance API: 代理到 Python 服务 ==========
  const PERFORMANCE_API_URL = getPerformanceApiBase();
  const performanceBase = PERFORMANCE_API_URL.replace(/\/+$/, "");

  /**
   * Proxy to the performance service, failing over local→public via the shared
   * loop. fetchJsonWithFallback throws on total failure (it does not pass the
   * upstream status through), so the catch reconstructs the previous contract
   * from the carried per-attempt error: pass an upstream non-2xx status through,
   * 502 on invalid JSON, else the detailed 503 with the start-the-service hint.
   */
  async function proxyPerformanceUpstream(
    res: Response,
    pathAndQuery: string,
    init: RequestInit,
    logLabel: string,
    userFacingError: string,
  ): Promise<void> {
    const path = pathAndQuery.startsWith("/") ? pathAndQuery : `/${pathAndQuery}`;
    try {
      const data = await fetchJsonWithFallback(
        resolveUpstreamBases("PERFORMANCE").map((base) => ({
          url: `${base}${path}`,
          init,
          parse: (raw: unknown) => raw,
        })),
        {
          timeoutMs: SERVER_CONFIG.PERFORMANCE_PROXY_TIMEOUT,
          label: logLabel,
          errorTag: "PERFORMANCE",
          // 18s timeout endpoint with cross-URL failover — a timeout retry would
          // ~2x the wait, so rely on failover (as NEWS/VALUATION).
          maxRetries: 0,
        },
      );
      res.status(200).json(data);
    } catch (error) {
      const last =
        error instanceof UpstreamFallbackError ? error.errors[error.errors.length - 1] : undefined;
      // Upstream answered with a non-2xx (e.g. 404) → pass the status through.
      // The body is no longer available; reproduce {error: <upstream message>}
      // (the "HTTP <n> - " prefix createRequestJson adds is stripped back off).
      if (last?.status) {
        res.status(last.status).json({ error: last.message.replace(/^HTTP \d{3} - /, "") });
        return;
      }
      // Reachable but returned non-JSON / unparseable body → 502.
      if (last?.code === "PARSE_ERROR") {
        logger.error(`❌ ${logLabel} non-JSON from upstream: ${last.message}`);
        res.status(502).json({ error: `${logLabel}: upstream returned invalid JSON` });
        return;
      }
      // Unreachable / network / timeout → detailed 503 with the startup hint.
      const msg = last?.message ?? (error instanceof Error ? error.message : String(error));
      logger.error(`❌ ${logLabel} fetch failed: ${msg}`);
      res.status(503).json({
        error: userFacingError,
        detail: msg,
        performanceUrl: PERFORMANCE_API_URL,
        hint:
          "Start the Python performance service (port 8502): npm run start:python:performance — or set PERFORMANCE_API_URL to a reachable host.",
      });
    }
  }

  // 解析公司名称到 ticker
  apiRouter.post("/performance/resolve", async (req, res) => {
    logger.info("🔍 /api/performance/resolve called");
    try {
      await proxyPerformanceUpstream(
        res,
        "/api/resolve",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(req.body),
        },
        "Performance resolve",
        "Failed to resolve company name",
      );
    } catch (error) {
      if (res.headersSent) return;
      const msg = error instanceof Error ? error.message : String(error);
      logger.error(`❌ Performance resolve unexpected: ${msg}`);
      res.status(500).json({ error: "Failed to resolve company name", detail: msg });
    }
  });

  // 查找同行公司
  apiRouter.post("/performance/find-peers", async (req, res) => {
    logger.info("🔍 /api/performance/find-peers called");
    try {
      await proxyPerformanceUpstream(
        res,
        "/api/find-peers",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(req.body),
        },
        "Performance find-peers",
        "Failed to find peer companies",
      );
    } catch (error) {
      if (res.headersSent) return;
      const msg = error instanceof Error ? error.message : String(error);
      logger.error(`❌ Performance find-peers unexpected: ${msg}`);
      res.status(500).json({ error: "Failed to find peer companies", detail: msg });
    }
  });

  // 获取财务指标
  apiRouter.post("/performance/get-metrics", async (req, res) => {
    logger.info("📊 /api/performance/get-metrics called");
    try {
      await proxyPerformanceUpstream(
        res,
        "/api/get-metrics",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(req.body),
        },
        "Performance get-metrics",
        "Failed to fetch financial metrics",
      );
    } catch (error) {
      if (res.headersSent) return;
      const msg = error instanceof Error ? error.message : String(error);
      logger.error(`❌ Performance get-metrics unexpected: ${msg}`);
      res.status(500).json({ error: "Failed to fetch financial metrics", detail: msg });
    }
  });

  // 同行对比分析
  apiRouter.post("/performance/peer-analysis", async (req, res) => {
    logger.info("📈 /api/performance/peer-analysis called");
    try {
      await proxyPerformanceUpstream(
        res,
        "/api/peer-key-metrics-conclusion",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(req.body),
        },
        "Performance peer-analysis",
        "Failed to generate peer analysis",
      );
    } catch (error) {
      if (res.headersSent) return;
      const msg = error instanceof Error ? error.message : String(error);
      logger.error(`❌ Performance peer-analysis unexpected: ${msg}`);
      res.status(500).json({ error: "Failed to generate peer analysis", detail: msg });
    }
  });

  // 完整公司财务分析 (一站式)
  apiRouter.get("/performance/company-analysis", async (req, res) => {
    logger.info("🎯 /api/performance/company-analysis called");
    try {
      const { ticker, peers, lang = "en" } = req.query;

      if (!ticker || typeof ticker !== "string") {
        return res.status(400).json({ error: "ticker parameter is required" });
      }

      const queryParams = new URLSearchParams({
        ticker: ticker as string,
        lang: lang as string,
      });

      if (peers && typeof peers === "string") {
        queryParams.append("peers", peers);
      }

      await proxyPerformanceUpstream(
        res,
        `/api/primary-company-analysis?${queryParams.toString()}`,
        { method: "GET" },
        "Performance company-analysis",
        "Failed to generate company analysis",
      );
    } catch (error) {
      if (res.headersSent) return;
      const msg = error instanceof Error ? error.message : String(error);
      logger.error(`❌ Performance company-analysis unexpected: ${msg}`);
      res.status(500).json({ error: "Failed to generate company analysis", detail: msg });
    }
  });

  // Performance API 健康检查
  apiRouter.get("/performance/health", async (req, res) => {
    logger.info("💚 /api/performance/health called");
    const url = `${performanceBase}/api/health`;
    try {
      const upstream = await fetch(url, { signal: AbortSignal.timeout(SERVER_CONFIG.PERFORMANCE_HEALTH_TIMEOUT) });
      const text = await upstream.text();
      let data: Record<string, unknown> = {};
      try {
        data = text ? (JSON.parse(text) as Record<string, unknown>) : {};
      } catch {
        return res.status(502).json({
          status: "unhealthy",
          proxy_status: "invalid-json",
          python_service_url: PERFORMANCE_API_URL,
          preview: text.slice(0, 200),
        });
      }
      res.json({
        ...data,
        proxy_status: "connected",
        python_service_url: PERFORMANCE_API_URL,
      });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      logger.error(`❌ Performance health check failed (${url}): ${msg}`);
      res.status(503).json({
        status: "unhealthy",
        proxy_status: "disconnected",
        python_service_url: PERFORMANCE_API_URL,
        error: "Cannot connect to Python Performance API service",
        detail: msg,
      });
    }
  });
}
