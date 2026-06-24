/**
 * Express routes for the Earnings API (upstream proxy + transcript QA + Nasdaq
 * calendar). Registered on the API router by routes.ts (mirrors
 * registerStockPickerRoutes / registerPerformanceRoutes). Endpoints:
 * /summarize-earnings, /earnings-fallback, /earnings/ask, /earnings/calendar,
 * /earnings/query.
 *
 * Extracted verbatim from routes.ts (per-domain split) — no behavior change.
 * Behavior pinned by L1 (routes.smoke.test.ts: route table + 400 contracts) and
 * L2 (routes/earnings.test.ts: calendar).
 */
import type { Router } from "express";
import { logger, cleanJsonResponse, SERVER_CONFIG } from "../utils";
import { fetchNasdaqEarningsCalendar, validateIsoDate } from "../earnings/nasdaqCalendar";
import { transcriptQaWithFallback, TranscriptQaError } from "../earnings/transcriptQaFallback";
import { getNewsApiBase, getSmartnewsApiBase } from "../upstreamConfig";
import { getDeepSeekKey, getPerplexityKey } from "./_shared";
import { callChatWithFailover, resolveChatChain } from "../llm/chat";
import {
  EARNINGS_SUMMARY_SYSTEM_PROMPT,
  buildEarningsSummaryUserMessage,
  EARNINGS_FALLBACK_SYSTEM_PROMPT,
} from "./earningsPrompts";

const SMARTNEWS_FALLBACK_API_BASE = getSmartnewsApiBase();

function isLocalBaseUrl(url: string): boolean {
  try {
    const host = new URL(url).hostname;
    return host === "localhost" || host === "127.0.0.1" || host === "0.0.0.0";
  } catch {
    return /localhost|127\.0\.0\.1|0\.0\.0\.0/.test(url);
  }
}

function getNewsApiCandidateBases(): string[] {
  const configured = getNewsApiBase();
  return [
    configured,
    ...(isLocalBaseUrl(configured) ? [SMARTNEWS_FALLBACK_API_BASE] : []),
  ];
}

async function fetchFromNewsApiCandidates(path: string, init?: RequestInit): Promise<Response> {
  let lastError: unknown = null;
  for (const baseUrl of getNewsApiCandidateBases()) {
    const url = `${baseUrl}${path}`;
    try {
      const response = await fetch(url, init);
      if (response.ok || !isLocalBaseUrl(baseUrl)) {
        return response;
      }
      logger.warn(`⚠️ SmartNews local upstream returned ${response.status}: ${url}`);
      lastError = new Error(`SmartNews upstream failed: ${response.status}`);
    } catch (error) {
      logger.warn(`⚠️ SmartNews upstream unreachable: ${url}`);
      lastError = error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error("SmartNews upstream unavailable");
}

interface LatestTranscriptMeta {
  year: number;
  quarter: number;
}

async function fetchLatestTranscriptMeta(
  ticker: string,
): Promise<LatestTranscriptMeta | null> {
  try {
    const latestRes = await fetch(
      `${getSmartnewsApiBase()}/api/earnings/latest-transcript/${ticker.toUpperCase()}`
    );

    if (!latestRes.ok) {
      logger.warn(`⚠️ latest-transcript API 响应失败: ${latestRes.status}`);
      return null;
    }

    const latestData = await latestRes.json();
    if (!latestData.success) {
      logger.warn("⚠️ latest-transcript 返回 success=false");
      return null;
    }

    const year = parseInt(latestData.year, 10);
    const quarter = parseInt(latestData.quarter, 10);

    if (Number.isNaN(year) || Number.isNaN(quarter)) {
      return null;
    }

    return { year, quarter };
  } catch (e) {
    logger.warn("⚠️ latest-transcript API 调用失败:", e instanceof Error ? e.message : "Unknown error");
    return null;
  }
}

function isQuarterAfterLatest(
  requestedYear: number,
  requestedQuarter: number,
  latest: LatestTranscriptMeta,
): boolean {
  return (
    requestedYear > latest.year ||
    (requestedYear === latest.year && requestedQuarter > latest.quarter)
  );
}

/**
 * Resolve missing year/quarter for a per-ticker earnings request.
 *
 * - Both provided → returned as-is.
 * - One missing → look up the smartnews per-ticker calendar and pick a
 *   *real* combination (latest released quarter for the given year, or most
 *   recent year for the given quarter). Avoids the old bug of mixing the
 *   user's year with the absolute-latest's quarter (e.g. "Q2 2025" when
 *   the user said "2025" and the latest absolute is Q2 2026).
 * - Both missing → falls back to latest-transcript (absolute latest).
 * - Last-resort time-based fallback if both upstream calls fail.
 */
async function resolveEarningsPeriod(
  ticker: string,
  rawYear: unknown,
  rawQuarter: unknown,
): Promise<{ year: number; quarter: number } | null> {
  const upperTicker = ticker.toUpperCase();
  let year: number | undefined =
    typeof rawYear === "number"
      ? rawYear
      : typeof rawYear === "string" && rawYear.trim().length > 0
        ? parseInt(rawYear, 10)
        : undefined;
  let quarter: number | undefined =
    typeof rawQuarter === "number"
      ? rawQuarter
      : typeof rawQuarter === "string" && rawQuarter.trim().length > 0
        ? parseInt(String(rawQuarter).replace(/^q/i, ""), 10)
        : undefined;
  if (year !== undefined && Number.isNaN(year)) year = undefined;
  if (quarter !== undefined && Number.isNaN(quarter)) quarter = undefined;

  // Both provided — done.
  if (year && quarter) return { year, quarter };

  // Track whether user-pinned values turn out to have no data — in that case
  // we'd rather return null than silently substitute, so the caller can
  // render an honest "no data for that period" answer.
  const userPinnedYear = year !== undefined;
  const userPinnedQuarter = quarter !== undefined;
  let pinnedYearHasNoRows = false;
  let pinnedQuarterHasNoRows = false;

  // One side missing — try to resolve via per-ticker calendar.
  if ((year && !quarter) || (!year && quarter)) {
    try {
      const calRes = await fetch(
        `${getSmartnewsApiBase()}/api/earnings-calendar?ticker=${encodeURIComponent(upperTicker)}`,
        { signal: AbortSignal.timeout(SERVER_CONFIG.EARNINGS_CALENDAR_TIMEOUT) },
      );
      if (calRes.ok) {
        const calJson = await calRes.json();
        const rows: Array<{ year: number | string; quarter: number | string; callDate: string }> =
          Array.isArray(calJson?.data) ? calJson.data : [];
        const today = Date.now();
        if (rows.length > 0) {
          if (year && !quarter) {
            const yearRows = rows.filter((r) => Number(r.year) === year);
            if (yearRows.length > 0) {
              const sorted = [...yearRows].sort(
                (a, b) => new Date(a.callDate).getTime() - new Date(b.callDate).getTime(),
              );
              const past = sorted.filter((r) => new Date(r.callDate).getTime() < today);
              const pick = past[past.length - 1] || sorted[0];
              const q = parseInt(String(pick.quarter).replace(/^q/i, ""), 10);
              if (q >= 1 && q <= 4) {
                quarter = q;
                logger.success(`✅ resolveEarningsPeriod: year=${year} → Q${quarter}`);
              }
            } else {
              logger.warn(`⚠️ resolveEarningsPeriod: ${upperTicker} has no calendar rows for ${year}`);
              pinnedYearHasNoRows = true;
            }
          } else if (!year && quarter) {
            const qRows = rows.filter(
              (r) => parseInt(String(r.quarter).replace(/^q/i, ""), 10) === quarter,
            );
            if (qRows.length > 0) {
              const sorted = [...qRows].sort(
                (a, b) => new Date(a.callDate).getTime() - new Date(b.callDate).getTime(),
              );
              const past = sorted.filter((r) => new Date(r.callDate).getTime() < today);
              const pick = past[past.length - 1] || sorted[0];
              year = Number(pick.year);
              logger.success(`✅ resolveEarningsPeriod: Q${quarter} → year=${year}`);
            } else {
              logger.warn(`⚠️ resolveEarningsPeriod: ${upperTicker} has no calendar rows for Q${quarter}`);
              pinnedQuarterHasNoRows = true;
            }
          }
        }
      } else {
        logger.warn(`⚠️ earnings-calendar API ${calRes.status}`);
      }
    } catch (e) {
      logger.warn("⚠️ earnings-calendar fetch failed:", e instanceof Error ? e.message : String(e));
    }
  }

  // Refuse to substitute when the user pinned a year/quarter that has no
  // calendar data — caller will render an honest "no data" answer rather
  // than mixing user year with an unrelated latest-transcript quarter.
  if (
    (userPinnedYear && pinnedYearHasNoRows && !quarter) ||
    (userPinnedQuarter && pinnedQuarterHasNoRows && !year)
  ) {
    logger.info(
      `ℹ️ resolveEarningsPeriod: refusing to substitute (user pinned ${userPinnedYear ? `year=${year}` : `quarter=Q${quarter}`} but calendar has no rows for it)`,
    );
    return null;
  }

  // Still missing → absolute-latest fallback (only when nothing was pinned).
  if (!year || !quarter) {
    const latest = await fetchLatestTranscriptMeta(upperTicker);
    if (latest) {
      year = year || latest.year;
      quarter = quarter || latest.quarter;
      logger.success(`✅ resolveEarningsPeriod: latest-transcript → ${year} Q${quarter}`);
    }
  }

  // Final fallback: time-based estimate.
  if (!year || !quarter) {
    const now = new Date();
    const currentYear = now.getFullYear();
    const currentMonth = now.getMonth() + 1;
    const currentQuarter = Math.ceil(currentMonth / 3);
    quarter = quarter || (currentQuarter === 1 ? 4 : currentQuarter - 1);
    year = year || (currentQuarter === 1 ? currentYear - 1 : currentYear);
    logger.info(`📅 resolveEarningsPeriod: time-based fallback → ${year} Q${quarter}`);
  }

  if (!year || !quarter) return null;
  return { year, quarter };
}

export function registerEarningsRoutes(apiRouter: Router): void {
  apiRouter.post("/summarize-earnings", async (req, res) => {
    console.log("📞 /api/summarize-earnings called");

    try {
      const { ticker, earningsContent } = req.body;

      if (!ticker) {
        return res.status(400).json({
          success: false,
          error: "Ticker is required",
        });
      }

      if (!earningsContent || earningsContent.length < 50) {
        return res.json({
          success: true,
          summary: "No earnings data",
          issues: [],
          sentiment: "neutral",
        });
      }

      // ✅ 改用DeepSeek
      const deepSeekKey = getDeepSeekKey();
      if (!deepSeekKey) {
        return res.json({
          success: true,
          summary: "DeepSeek API not configured",
          issues: [],
          sentiment: "neutral",
        });
      }

      console.log(`🔍 Summarizing earnings for ${ticker} using DeepSeek`);

      const { response } = await callChatWithFailover(resolveChatChain(), {
        temperature: 0.1,
        max_tokens: 300,
        messages: [
          { role: "system", content: EARNINGS_SUMMARY_SYSTEM_PROMPT },
          { role: "user", content: buildEarningsSummaryUserMessage(ticker, earningsContent) },
        ],
      });
      const content = response.choices?.[0]?.message?.content || "{}";

      logger.debug("DeepSeek response:", content);

      // 清理可能的markdown包裹
      const cleanContent = cleanJsonResponse(content);
      const result = JSON.parse(cleanContent);

      logger.success(`Earnings summary: ${result.sentiment || "neutral"}`);

      res.json({
        success: true,
        ticker,
        summary: result.summary || "Analysis completed",
        issues: Array.isArray(result.issues) ? result.issues : [],
        sentiment: result.sentiment || "neutral",
      });
    } catch (error) {
      console.error("❌ Earnings summary error:", error);
      res.json({
        success: true,
        summary: "Analysis failed",
        issues: [],
        sentiment: "neutral",
      });
    }
  });

  // ========== 股票推荐 API - 修复 JSON 解析 ==========
  apiRouter.post("/earnings-fallback", async (req, res) => {
    console.log("🔄 /api/earnings-fallback called (DeepSeek)");

    try {
      const { query } = req.body;

      if (!query || typeof query !== "string") {
        return res.status(400).json({
          success: false,
          error: "Valid query is required",
        });
      }

      console.log(`🤖 Using DeepSeek for earnings analysis: "${query}"`);

      const deepSeekKey = getDeepSeekKey();
      if (!deepSeekKey) {
        return res.status(503).json({
          success: false,
          error: "DeepSeek API not configured",
        });
      }

      const { response, providerId } = await callChatWithFailover(resolveChatChain(), {
        temperature: 0.3,
        max_tokens: 1200,
        messages: [
          { role: "system", content: EARNINGS_FALLBACK_SYSTEM_PROMPT },
          { role: "user", content: query },
        ],
      });
      const aiResponse = response.choices?.[0]?.message?.content;

      if (!aiResponse) {
        throw new Error("Empty response from DeepSeek");
      }

      console.log("✅ DeepSeek earnings analysis completed");

      // 格式化响应
      const formattedResponse = `<strong>📞 Earnings Analysis</strong><br><br>

  <div style="padding: 12px; background: linear-gradient(135deg, #fef3c7 0%, #fde68a 100%);
       border-left: 4px solid #f59e0b; border-radius: 8px; margin-bottom: 16px;">
    <strong style="color: #92400e;">ℹ️ AI-Generated Analysis</strong><br>
    <span style="font-size: 0.9em; color: #78350f;">
      Real-time earnings data is temporarily unavailable. This analysis is based on historical patterns and market knowledge.
    </span>
  </div>

  ${aiResponse}

  <div style="margin-top: 20px; padding: 12px; background: #eff6ff;
       border-radius: 8px; border-left: 4px solid #3b82f6;">
    <strong>💡 For Latest Earnings Data:</strong><br>
    • Check the company's investor relations page<br>
    • Visit SEC EDGAR for official filings<br>
    • Use financial platforms like Yahoo Finance or Seeking Alpha
  </div>`;

      res.json({
        success: true,
        query,
        response: formattedResponse,
        provider: providerId,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      console.error("❌ Earnings fallback error:", error);

      res.status(500).json({
        success: false,
        error: "Failed to generate earnings analysis",
        details: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });

  // ========== Earnings transcript QA API ==========
  apiRouter.post("/earnings/ask", async (req, res) => {
    logger.info("📊 /api/earnings/ask called");

    try {
      let { ticker, year, quarter, question, query: rawQuery } = req.body;

      if (!ticker || typeof ticker !== "string") {
        return res.status(400).json({
          success: false,
          error: "ticker is required (e.g., 'TSLA', 'AAPL')",
        });
      }

      const normalizedQuestion =
        typeof question === "string" && question.trim().length > 0
          ? question.trim()
          : typeof rawQuery === "string" && rawQuery.trim().length > 0
            ? rawQuery.trim()
            : "";

      if (!normalizedQuestion) {
        return res.status(400).json({
          success: false,
          error: "question is required",
        });
      }

      let latestTranscriptMeta: LatestTranscriptMeta | null = null;

      const resolved = await resolveEarningsPeriod(ticker, year, quarter);
      if (!resolved) {
        return res.status(404).json({
          success: false,
          ticker: ticker.toUpperCase(),
          requested: { year, quarter },
          error: `No earnings data available for ${ticker.toUpperCase()}${year ? ` ${year}` : ""}${quarter ? ` Q${quarter}` : ""}`,
          code: "no_data_for_requested_period",
        });
      }
      year = resolved.year;
      quarter = resolved.quarter;

      if (typeof year !== "number" || year < 2020 || year > 2030) {
        return res.status(400).json({
          success: false,
          error: "year must be a valid number (2020-2030)",
        });
      }

      if (typeof quarter !== "number" || quarter < 1 || quarter > 4) {
        return res.status(400).json({
          success: false,
          error: "quarter must be 1-4",
        });
      }

      const upperTicker = ticker.toUpperCase();
      const API_BASE = getSmartnewsApiBase();

      latestTranscriptMeta =
        latestTranscriptMeta || (await fetchLatestTranscriptMeta(upperTicker));

      if (
        latestTranscriptMeta &&
        isQuarterAfterLatest(year, quarter, latestTranscriptMeta)
      ) {
        return res.status(404).json({
          success: false,
          ticker: upperTicker,
          requested: { year, quarter },
          error: `Q${quarter} ${year} earnings not yet released`,
          fallback_available: latestTranscriptMeta,
          hint: `Latest available earnings call is Q${latestTranscriptMeta.quarter} ${latestTranscriptMeta.year}`,
        });
      }

      logger.info(
        `📋 Ask request: ticker=${upperTicker}, Q${quarter} ${year}, question=${normalizedQuestion.slice(0, 80)}`
      );

      let data: any;
      try {
        data = await transcriptQaWithFallback({
          ticker: upperTicker,
          year,
          quarter,
          question: normalizedQuestion,
          apiBase: API_BASE,
          apiKey: process.env.EQUITY_TRANSCRIPT_QA_API_KEY,
          perplexityKey: getPerplexityKey(),
        });
      } catch (error) {
        if (error instanceof TranscriptQaError) {
          return res.status(error.status).json({
            success: false,
            error: error.message,
            code: error.code,
          });
        }
        throw error;
      }

      res.json({
        success: true,
        ticker: upperTicker,
        year,
        quarter,
        topic: "transcript_qa",
        data,
      });
    } catch (error) {
      console.error("❌ Earnings ask error:", error);

      res.status(500).json({
        success: false,
        error: "Internal server error",
        details: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });

  // ========== Nasdaq earnings calendar (by date) ==========
  apiRouter.get("/earnings/calendar", async (req, res) => {
    try {
      const raw =
        typeof req.query.date === "string" ? req.query.date.trim() : "";
      if (raw && !validateIsoDate(raw)) {
        return res.status(400).json({
          success: false,
          error: "Invalid date; use YYYY-MM-DD",
        });
      }
      const date =
        raw && validateIsoDate(raw)
          ? raw
          : new Date().toISOString().split("T")[0];
      const calendar = await fetchNasdaqEarningsCalendar(date);
      return res.json({
        success: true,
        topic: "calendar",
        date,
        source: "nasdaq",
        calendar,
      });
    } catch (error) {
      logger.error("❌ /api/earnings/calendar:", error);
      return res.status(502).json({
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Failed to load Nasdaq earnings calendar",
      });
    }
  });

  // ========== 统一 Earnings 查询 API ==========
  apiRouter.post("/earnings/query", async (req, res) => {
    logger.info("📊 /api/earnings/query called");

    try {
      let { ticker, year, quarter, topic, lang, question, query: rawQuery } = req.body;
      lang = lang === "zh" ? "zh" : "en";

      // ============================================
      // 参数验证和自动补全
      // ============================================

      if (!ticker || typeof ticker !== "string") {
        return res.status(400).json({
          success: false,
          error: "ticker is required (e.g., 'TSLA', 'AAPL')",
        });
      }

      // ✅ 自动补全 topic（如果未提供，默认为 summary）
      if (!topic || typeof topic !== "string") {
        topic = "summary";
        logger.info("📋 topic 未提供，自动设置为 'summary'");
      }

      // ✅ Resolve year/quarter via shared helper (calendar-aware: avoids
      // mixing user year with absolute-latest quarter).
      const resolvedPeriod = await resolveEarningsPeriod(ticker, year, quarter);
      if (!resolvedPeriod) {
        // User pinned a year/quarter we have no data for. Don't silently
        // substitute — return a clear 404 so the caller can render an honest
        // "no data for that period" answer (apiCaller falls back to smartnews
        // ask → web RAG, which can answer or honestly say it doesn't know).
        return res.status(404).json({
          success: false,
          ticker: ticker.toUpperCase(),
          requested: { year, quarter },
          error: `No earnings data available for ${ticker.toUpperCase()}${year ? ` ${year}` : ""}${quarter ? ` Q${quarter}` : ""}`,
          code: "no_data_for_requested_period",
        });
      }
      if (resolvedPeriod) {
        year = resolvedPeriod.year;
        quarter = resolvedPeriod.quarter;
      }

      // ✅ 参数验证
      if (typeof year !== "number" || year < 2020 || year > 2030) {
        return res.status(400).json({
          success: false,
          error: "year must be a valid number (2020-2030)",
        });
      }

      if (typeof quarter !== "number" || quarter < 1 || quarter > 4) {
        return res.status(400).json({
          success: false,
          error: "quarter must be 1-4",
        });
      }

      const validTopics = ["summary", "qa", "transcript", "transcript_qa"];
      if (!validTopics.includes(topic)) {
        return res.status(400).json({
          success: false,
          error: "topic must be one of: summary, qa, transcript, transcript_qa",
        });
      }

      const upperTicker = ticker.toUpperCase();
      const normalizedQuestion =
        typeof question === "string" && question.trim().length > 0
          ? question.trim()
          : typeof rawQuery === "string" && rawQuery.trim().length > 0
            ? rawQuery.trim()
            : "";

      if (topic === "transcript_qa" && !normalizedQuestion) {
        return res.status(400).json({
          success: false,
          error: "question is required when topic is transcript_qa",
        });
      }

      console.log(
        `📋 Request: ticker=${upperTicker}, Q${quarter} ${year}, topic=${topic}, lang=${lang}${topic === "transcript_qa" ? `, question=${normalizedQuestion.slice(0, 80)}` : ""}`,
      );

      // ============================================
      // 根据 topic 获取数据
      // ============================================

      let data: any = null;

      if (topic === "transcript_qa") {
        const latestTranscriptMeta = await fetchLatestTranscriptMeta(upperTicker);
        if (
          latestTranscriptMeta &&
          isQuarterAfterLatest(year, quarter, latestTranscriptMeta)
        ) {
          return res.status(404).json({
            success: false,
            ticker: upperTicker,
            requested: { year, quarter },
            error: `Q${quarter} ${year} earnings not yet released`,
            fallback_available: latestTranscriptMeta,
            hint: `Latest available earnings call is Q${latestTranscriptMeta.quarter} ${latestTranscriptMeta.year}`,
          });
        }
      }

      if (topic === "transcript") {
        const response = await fetchFromNewsApiCandidates(
          `/api/ninjas/transcript?ticker=${upperTicker}&year=${year}&quarter=Q${quarter}`,
        );

        if (!response.ok) {
          // 计算建议的回退季度
          const fallbackQuarter = quarter === 1 ? 4 : quarter - 1;
          const fallbackYear = quarter === 1 ? year - 1 : year;

          return res.status(404).json({
            success: false,
            ticker: upperTicker,
            requested: { year, quarter },
            error: `Q${quarter} ${year} earnings not yet released`,
            fallback_available: {
              year: fallbackYear,
              quarter: fallbackQuarter,
            },
            hint: "Consider querying the previous quarter or waiting for release",
          });
        }

        const result = await response.json();
        if (!result.success) {
          return res.status(404).json({
            success: false,
            error: result.error || "Failed to fetch transcript",
          });
        }

        data = {
          metadata: result.metadata,
          participants: result.participants || [],
          transcript_split: result.transcriptSplit || [],
        };
      } else if (topic === "transcript_qa") {
        try {
          data = await transcriptQaWithFallback({
            ticker: upperTicker,
            year,
            quarter,
            question: normalizedQuestion,
            apiBase: SMARTNEWS_FALLBACK_API_BASE,
            apiKey: process.env.EQUITY_TRANSCRIPT_QA_API_KEY,
            perplexityKey: getPerplexityKey(),
          });
        } catch (error) {
          if (error instanceof TranscriptQaError) {
            return res.status(error.status).json({
              success: false,
              error: error.message,
              code: error.code,
            });
          }
          throw error;
        }
      } else {
        // summary 或 qa
        const response = await fetchFromNewsApiCandidates(
          `/api/earnings/ai-doc?ticker=${upperTicker}&year=${year}&quarter=Q${quarter}&docType=${topic}&lang=${lang}`,
        );

        if (!response.ok) {
          // 计算建议的回退季度
          const fallbackQuarter = quarter === 1 ? 4 : quarter - 1;
          const fallbackYear = quarter === 1 ? year - 1 : year;

          return res.status(404).json({
            success: false,
            ticker: upperTicker,
            requested: { year, quarter },
            error: `Q${quarter} ${year} earnings not yet released`,
            fallback_available: {
              year: fallbackYear,
              quarter: fallbackQuarter,
            },
            hint: "Consider querying the previous quarter or waiting for release",
          });
        }

        const result = await response.json();

        if (!result.success) {
          if (
            result.error?.includes("generating") ||
            result.error?.includes("请稍后")
          ) {
            return res.json({
              success: false,
              status: "generating",
              message:
                "Document is being generated, please try again in a few minutes.",
            });
          }
          return res.status(404).json({
            success: false,
            error: result.error || `Failed to fetch ${topic}`,
          });
        }

        // 只返回核心数据
        data = result.data?.sections || result.data;
      }

      // ============================================
      // 返回简洁的 JSON 结果
      // ============================================

      res.json({
        success: true,
        ticker: upperTicker,
        year,
        quarter,
        topic,
        data,
      });
    } catch (error) {
      console.error("❌ Earnings query error:", error);

      res.status(500).json({
        success: false,
        error: "Internal server error",
        details: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });
}
