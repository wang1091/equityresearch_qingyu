// 并行API调用模块
import { logger } from "../utils";
import { normalizeNewsResponse } from "./newsResponseAdapter";
import { getCompetitiveApiBase, resolveUpstreamBases } from "../upstreamConfig";
import { getLocalApiBase } from "../localApi";
import { fetchJsonWithFallback } from "../upstreamFetch";
import { fetchStockPickerCard } from "../stockPicker/service";
import { fetchEarningsData } from "../earnings/service";
import { fetchPerformanceData } from "../performance/service";
import { runPlan } from "../../strategy";
import { PLAN_REGISTRY } from "./planRegistry";
import type { DataSource } from "./intentSources";
import {
  containsChinese,
  localizeKnownFallbackText,
  needsTranslationForLanguage,
  translateJsonValuesToLanguage,
  translateTextToLanguage,
} from "../translation";

// API配置
const NEWS_API_TIMEOUT_MS = 90000;
const VALUATION_API_TIMEOUT_MS = 90000;
const UPSTREAM_ERROR_BODY_LIMIT = 1000;

interface ApiCallResult {
  dataSource: string;
  success: boolean;
  data?: any;
  error?: string;
}




async function localizeNewsData(data: any, lang?: string): Promise<any> {
  if ((lang !== "zh" && lang !== "en") || !data) {
    return data;
  }

  data = {
    ...data,
    content: {
      ...data.content,
      summary: localizeKnownFallbackText(data.content?.summary, lang),
    },
    summary: localizeKnownFallbackText(data.summary, lang),
    newsContent: localizeKnownFallbackText(data.newsContent, lang),
  };

  const translated = await translateJsonValuesToLanguage(
    {
      content: {
        summary: data.content?.summary || "",
        title: data.content?.title || "",
        dek: data.content?.dek || "",
        items: Array.isArray(data.content?.items)
          ? data.content.items.map((item: any) => ({
              headline: item.headline || "",
              summary: item.summary || "",
            }))
          : [],
        sections: Array.isArray(data.content?.sections)
          ? data.content.sections.map((section: any) => ({
              heading: section.heading || "",
              paragraphs: Array.isArray(section.paragraphs) ? section.paragraphs : [],
              bullets: Array.isArray(section.bullets) ? section.bullets : [],
            }))
          : [],
        notes: Array.isArray(data.content?.notes) ? data.content.notes : [],
      },
      search_results: Array.isArray(data.search_results)
        ? data.search_results.map((source: any) => ({
            title: source.title || "",
            snippet: source.snippet || "",
          }))
        : [],
    },
    "news card",
    lang,
    8000
  );

  if (!translated) {
    return data;
  }

  const content = {
    ...data.content,
    ...translated.content,
  };

  const searchResults = Array.isArray(data.search_results)
    ? data.search_results.map((source: any, index: number) => ({
        ...source,
        title: translated.search_results?.[index]?.title || source.title,
        snippet: translated.search_results?.[index]?.snippet || source.snippet,
      }))
    : data.search_results;

  const items = Array.isArray(data.items)
    ? data.items.map((item: any, index: number) => {
        const translatedItem = translated.content?.items?.[index];
        return {
          ...item,
          headline: translatedItem?.headline || item.headline,
          summary: translatedItem?.summary || item.summary,
          title: translatedItem?.headline || item.title,
        };
      })
    : data.items;

  return {
    ...data,
    content,
    search_results: searchResults,
    summary: content.summary || data.summary,
    newsContent: content.summary || data.newsContent,
    title: content.title || data.title,
    dek: content.dek || data.dek,
    sections: content.sections || data.sections,
    notes: content.notes || data.notes,
    items,
    sources: searchResults || data.sources,
  };
}

async function localizeValuationData(data: any, lang?: string): Promise<any> {
  if (lang !== "zh" || !data) {
    return data;
  }

  const localized = { ...data };

  if (needsTranslationForLanguage(localized.rationale, "zh")) {
    localized.rationale = await translateTextToLanguage(localized.rationale, "zh", "plain");
  }

  if (needsTranslationForLanguage(localized.response, "zh")) {
    localized.response = await translateTextToLanguage(localized.response, "zh", "html");
  }

  return localized;
}

// localizeRatingData moved to ./localize (used by the RATING plan in planRegistry).

async function localizeCompetitiveData(data: any, lang?: string): Promise<any> {
  if (lang !== "zh" || !data) {
    return data;
  }

  const needsTranslation =
    !containsChinese(data.overall_assessment) ||
    Object.values(data.forces || {}).some(
      (force: any) => !containsChinese(force?.analysis)
    );

  if (!needsTranslation) {
    return data;
  }

  const translated = await translateJsonValuesToLanguage(
    {
      industry: data.industry || "",
      overall_assessment: data.overall_assessment || "",
      forces: Object.fromEntries(
        Object.entries(data.forces || {}).map(([key, force]: [string, any]) => [
          key,
          {
            ...force,
            analysis: force?.analysis || "",
          },
        ])
      ),
    },
    "competitive analysis card",
    "zh",
  );

  if (!translated) {
    return data;
  }

  return {
    ...data,
    industry: translated.industry || data.industry,
    overall_assessment:
      translated.overall_assessment || data.overall_assessment,
    forces: Object.fromEntries(
      Object.entries(data.forces || {}).map(([key, force]: [string, any]) => [
        key,
        {
          ...force,
          analysis:
            translated.forces?.[key]?.analysis || force?.analysis,
        },
      ])
    ),
  };
}

// localizeRumorData moved to ./localize (used by the RUMOR plan in planRegistry).

export type ApiCallContext = {
  /** Original user message — used to recover Nasdaq calendar when routing missed it */
  userMessage?: string;
};

/**
 * 根据数据需求并行调用所有相关API
 */
export async function callApis(
  requiredData: string[],
  apiParams: Record<string, any>,
  onToolCall?: (info: { dataSource: string; status: 'start' | 'success' | 'error'; data?: any; error?: string; duration?: number }) => void,
  context?: ApiCallContext,
): Promise<Record<string, any>> {
  logger.info(`📞 开始并行调用 ${requiredData.length} 个数据源`);

  const apiCalls: Promise<ApiCallResult>[] = [];

  for (const dataSource of requiredData) {
    const params = apiParams[dataSource];
    if (!params) {
      logger.warn(`⚠️ ${dataSource} 缺少参数，跳过`);
      continue;
    }

    // 通知开始调用
    if (onToolCall) {
      onToolCall({ dataSource, status: 'start' });
    }

    // 处理参数为数组的情况（多ticker）
    if (Array.isArray(params)) {
      // 多ticker场景：为每个ticker分别调用API
      for (const singleParam of params) {
        apiCalls.push(callSingleApi(dataSource, singleParam, onToolCall, context));
      }
    } else {
      // 单ticker或无ticker
      apiCalls.push(callSingleApi(dataSource, params, onToolCall, context));
    }
  }

  // 并行执行所有API调用
  const results = await Promise.allSettled(apiCalls);

  // 整合结果
  const apiData: Record<string, any> = {};
  let successCount = 0;
  const failedSources: string[] = [];

  results.forEach((result) => {
    if (result.status === "fulfilled") {
      const { dataSource, success, data, error } = result.value;
      if (success) {
        // 如果同一个dataSource有多个结果（多ticker），需要合并
        if (apiData[dataSource]) {
          // 已有结果，需要合并
          if (Array.isArray(apiData[dataSource])) {
            apiData[dataSource].push(data);
          } else {
            // 第一次是单个对象，转换为数组
            apiData[dataSource] = [apiData[dataSource], data];
          }
        } else {
          // 第一次添加
          apiData[dataSource] = data;
        }
        successCount++;
      } else {
        logger.error("apicaller.source_failed", {
          source: dataSource,
          reason: typeof error === "string" ? error : String(error),
        });
        failedSources.push(dataSource);
        if (!apiData[dataSource]) {
          apiData[dataSource] = { error };
        }
      }
    } else {
      logger.error("apicaller.source_failed", {
        reason: result.reason instanceof Error ? result.reason.message : String(result.reason),
      });
    }
  });

  logger.success(`✅ API调用完成: ${successCount}/${results.length} 成功`);

  // 如果有失败的非关键数据源，记录但不影响流程
  if (failedSources.length > 0) {
    const nonCritical = ["PERFORMANCE", "COMPETITIVE", "PEER_STOCKS"];
    const criticalFailed = failedSources.filter(s => !nonCritical.includes(s));

    if (criticalFailed.length > 0) {
      logger.warn("apicaller.degraded", { severity: "critical", sources: criticalFailed });
    } else {
      logger.info("apicaller.degraded", { severity: "non_critical", sources: failedSources });
    }
  }

  return apiData;
}

/**
 * 调用单个API
 */
async function callSingleApi(
  dataSource: string,
  params: any,
  onToolCall?: (info: { dataSource: string; status: 'start' | 'success' | 'error'; data?: any; error?: string; duration?: number }) => void,
  context?: ApiCallContext,
): Promise<ApiCallResult> {
  const startTime = Date.now();

  // 构建用于日志的 dataSource 标识（包含ticker）
  const getLogLabel = () => {
    if (params.ticker) {
      return `${dataSource}[${params.ticker}]`;
    }
    return dataSource;
  };

  const logLabel = getLogLabel();

  // Shared success tail (onToolCall notify + result shape) — used by both the
  // plan-registry path and the legacy switch's common tail.
  const finishSuccess = (data: any): ApiCallResult => {
    const duration = Date.now() - startTime;
    if (onToolCall && data) {
      onToolCall({ dataSource, status: 'success', data, duration });
    }
    return { dataSource, success: true, data };
  };

  try {
    let response: Response;
    let data: any;
    const localApiBase = getLocalApiBase();

    // Migrated sources fetch via the strategy plan layer (no loopback self-call);
    // the rest fall through to the legacy switch below.
    const planBuilder = PLAN_REGISTRY[dataSource as DataSource];
    if (planBuilder) {
      data = await runPlan(planBuilder(params, context));
      logger.info(`  ✓ ${logLabel} (${Date.now() - startTime}ms)`);
      return finishSuccess(data);
    }

    switch (dataSource) {
      // STOCK_PRICE migrated to PLAN_REGISTRY (planRegistry.ts → fetchStockPrice).

      case "VALUATION": {
        const valuationInit: RequestInit = {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ticker: params.ticker }),
        };
        const valuationUrls = resolveUpstreamBases("VALUATION").map(
          (baseUrl) => `${baseUrl}/api/full-valuation`,
        );

        data = await fetchJsonWithFallback(
          valuationUrls.map((url) => ({
            url,
            init: valuationInit,
            parse: (raw: unknown) => raw,
          })),
          {
            timeoutMs: VALUATION_API_TIMEOUT_MS,
            label: logLabel,
            errorTag: "VALUATION",
            bodyLogLimit: UPSTREAM_ERROR_BODY_LIMIT,
            // 90s timeout endpoint with cross-URL failover — a timeout retry
            // would ~2x the wait, so rely on failover. Circuit + logging stay.
            maxRetries: 0,
          },
        );

        data = await localizeValuationData(data, params.lang);
        logger.info(`  ✓ ${logLabel} (${Date.now() - startTime}ms)`);
        break;
      }

      case "NEWS": {
        const newsParams = { ...params };
        const responseLanguage = newsParams.responseLanguage || newsParams.lang || newsParams.language || "en";
        newsParams.lang = responseLanguage;
        newsParams.language = "en";
        newsParams.responseLanguage = responseLanguage;
        if (newsParams.query) {
          newsParams.query = newsParams.query + " (Summarize all content in English)";
        }
        const newsInit: RequestInit = {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(newsParams),
        };
        const newsUrls = resolveUpstreamBases("NEWS").map(
          (baseUrl) => `${baseUrl}/api/search-news-v2`,
        );

        // normalize + localize run inside parse, so a malformed body rejects the
        // attempt and falls back to the next base (preserving prior behavior).
        data = await fetchJsonWithFallback(
          newsUrls.map((url) => ({
            url,
            init: newsInit,
            parse: async (raw: unknown) =>
              localizeNewsData(normalizeNewsResponse(raw), responseLanguage),
          })),
          {
            timeoutMs: NEWS_API_TIMEOUT_MS,
            label: logLabel,
            errorTag: "NEWS",
            bodyLogLimit: UPSTREAM_ERROR_BODY_LIMIT,
            // 90s timeout endpoint with cross-URL failover — a timeout retry
            // would ~2x the wait, so rely on failover. Circuit + logging stay.
            maxRetries: 0,
          },
        );

        logger.info(`  ✓ ${logLabel} (${Date.now() - startTime}ms)`);
        break;
      }

      case "EARNINGS":
        data = await fetchEarningsData(params, context, logLabel);
        break;

      case "PERFORMANCE":
        data = await fetchPerformanceData(params, logLabel);
        break;

      // RATING migrated to PLAN_REGISTRY (planRegistry.ts → fetchAnalystRating).

      case "COMPETITIVE": {
        // Provider dispatch — Node (DeepSeek) is the default. Flask (GPT-4o)
        // exposes the same contract at $COMPETITIVE_FLASK_URL/api/competitive-analysis
        // and is reachable via:
        //   COMPETITIVE_PROVIDER=flask        → call Flask first
        //   COMPETITIVE_AUTO_FAILOVER=false   → disable retry on the other provider
        // The default behavior (no env set) is "Node primary, auto-fallback to
        // Flask on UPSTREAM_LLM_FAILED" — Perplexity is shared so failures of
        // the research layer affect both; only the analysis layer (DeepSeek vs
        // GPT-4o) gives the failover real meaning.
        const provider = (process.env.COMPETITIVE_PROVIDER || "node").trim().toLowerCase();
        const flaskBase = getCompetitiveApiBase();
        const autoFailover = process.env.COMPETITIVE_AUTO_FAILOVER !== "false";
        const nodeUrl = `${localApiBase}/api/competitive-analysis`;
        const flaskUrl = `${flaskBase}/api/competitive-analysis`;
        const primaryUrl = provider === "flask" ? flaskUrl : nodeUrl;
        const fallbackUrl = provider === "flask" ? nodeUrl : flaskUrl;
        const requestBody = JSON.stringify({
          ticker: params.ticker,
          companyName: params.companyName || params.ticker,
          industry: params.industry || "",
          lang: params.lang === "zh" ? "zh" : "en",
        });

        const callProvider = async (url: string) => {
          const r = await fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: requestBody,
            signal: AbortSignal.timeout(60000),
          });
          const d = await r.json();
          return { httpOk: r.ok, data: d };
        };

        let attempt = await callProvider(primaryUrl);
        // Failover only on analysis-layer failures: research/Perplexity is
        // shared between providers, so retrying there is wasted work.
        const isLlmFailure =
          attempt.data?.success === false &&
          attempt.data?.code === "UPSTREAM_LLM_FAILED";
        if (autoFailover && isLlmFailure) {
          logger.warn(
            `⚠️ COMPETITIVE primary (${primaryUrl}) returned UPSTREAM_LLM_FAILED — failing over to ${fallbackUrl}`,
          );
          const retry = await callProvider(fallbackUrl);
          if (retry.data?.success !== false) {
            attempt = retry;
          }
        }
        data = attempt.data;
        data = await localizeCompetitiveData(data, params.lang);
        logger.info(`  ✓ ${logLabel} (${Date.now() - startTime}ms)`);
        break;
      }

      // STOCK_PRICE, RATING, PEER_STOCKS, FDA, RUMOR, MARKET_DATA, TRENDING
      // migrated to PLAN_REGISTRY (planRegistry.ts).

      case "GENERAL":
        return {
          dataSource,
          success: true,
          data: { type: "general", query: params.query },
        };

      case "STOCK_PICKER":
        // Fan-out + validation + payload shaping live in the stockPicker module.
        data = await fetchStockPickerCard(params, logLabel);
        break;

      default:
        logger.warn(`⚠️ 未知数据源: ${dataSource}`);
        return {
          dataSource,
          success: false,
          error: `Unknown data source: ${dataSource}`,
        };
    }

    return finishSuccess(data);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    const duration = Date.now() - startTime;

    // 通知失败
    if (onToolCall) {
      onToolCall({ dataSource, status: 'error', error: errorMessage, duration });
    }

    if (error instanceof Error && error.name === "TimeoutError") {
      logger.error(`⏰ ${logLabel} 超时 (${duration}ms): ${errorMessage}`);

      // 针对 PERFORMANCE 的特殊提示
      if (dataSource === "PERFORMANCE") {
        logger.warn(`💡 提示: PERFORMANCE API 可能需要更长时间计算财务数据`);
        logger.warn(`💡 当前超时: 30秒，实际耗时: ${duration}ms`);
      }
    } else {
      logger.error(`❌ ${logLabel} 失败 (${duration}ms): ${errorMessage}`);
    }

    return {
      dataSource,
      success: false,
      error: errorMessage,
    };
  }
}
