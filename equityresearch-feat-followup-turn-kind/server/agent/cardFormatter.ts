// server/agent/cardFormatter.ts
// 单意图直接卡片格式化模块
// 将API返回的JSON数据格式化为HTML卡片，跳过DeepSeek LLM生成
import { logger } from "../utils";
import { dumpCardFixture } from "./cardFixtures";
import { formatErrorCard } from "./formatters/_shared";
import { formatValuationCard } from "./formatters/valuation";
import { formatStockPriceCard } from "./formatters/stockPrice";
import { formatRatingCard } from "./formatters/rating";
import { formatCompetitiveCard } from "./formatters/competitive";
import { formatFDACard } from "./formatters/fda";
import { formatNewsCard } from "./formatters/news";
import { formatMarketDataCard } from "./formatters/marketData";
import { formatTrendingCard } from "./formatters/trending";
import { formatPerformanceCard } from "./formatters/performance";
import { formatEarningsCard } from "./formatters/earnings";
import { formatRumorCard } from "./formatters/rumor";

// ==========================================
// 支持直接卡片的数据源列表
// ==========================================
const DIRECT_CARD_SOURCES = [
  "VALUATION",
  "STOCK_PRICE",
  "RATING",
  "COMPETITIVE",
  "FDA",
  "NEWS",
  "EARNINGS",
  "PERFORMANCE",
  "RUMOR",
  "TRENDING",
  "MARKET_DATA"
];

/**
 * 判断数据源是否支持直接卡片
 */
export function isDirectCardSupported(dataSource: string): boolean {
  return DIRECT_CARD_SOURCES.includes(dataSource);
}

/**
 * True when submodule API data is missing or represents a failed call
 * ({ error }, success: false, or empty array). Used to skip direct HTML/news_v2
 * cards and fall back to LLM stream generation.
 */
export function isDirectCardApiFailure(apiData: unknown): boolean {
  if (apiData == null) {
    return true;
  }
  if (Array.isArray(apiData)) {
    if (apiData.length === 0) {
      return true;
    }
    return apiData.every((item) => isDirectCardApiFailure(item));
  }
  if (typeof apiData === "object") {
    const rec = apiData as Record<string, unknown>;
    const err = rec.error;
    if (typeof err === "string" && err.length > 0) {
      return true;
    }
    if (rec.success === false) {
      return true;
    }
  }
  return false;
}

/**
 * 将API数据格式化为HTML卡片
 * @param dataSource - 数据源类型
 * @param apiData - API返回的原始数据
 * @param language - 语言 "zh" | "en"
 * @returns HTML字符串，失败返回null
 */
export function formatDataAsCard(
  dataSource: string,
  apiData: any,
  language: string = "en"
): string | null {
  try {
    dumpCardFixture(dataSource, language, apiData); // no-op unless DUMP_CARD_FIXTURES set
    if (!apiData || apiData.error) {
      return formatErrorCard(dataSource, apiData?.error || "No data available");
    }

    switch (dataSource) {
      case "VALUATION":
        return formatValuationCard(apiData, language);
      case "STOCK_PRICE":
        return formatStockPriceCard(apiData, language);
      case "RATING":
        return formatRatingCard(apiData, language);
      case "COMPETITIVE":
        return formatCompetitiveCard(apiData, language);
      case "FDA":
        return formatFDACard(apiData, language);
      case "NEWS":
        return formatNewsCard(apiData, language);
      case "EARNINGS":
        return formatEarningsCard(apiData, language);
      case "PERFORMANCE":
        return formatPerformanceCard(apiData, language);
      case "RUMOR":
        return formatRumorCard(apiData, language);
      case "TRENDING":
        // Always return a card — even on API failure — so the output is
        // consistent across all categories (gainers, losers, active, discussed).
        return formatTrendingCard(apiData, language);
      case "MARKET_DATA":
        return formatMarketDataCard(apiData, language);
      default:
        logger.warn(`⚠️ cardFormatter: unsupported source ${dataSource}`);
        return null;
    }
  } catch (error) {
    logger.error(`❌ cardFormatter error for ${dataSource}:`,
    error instanceof Error ? error.stack : JSON.stringify(error)
  );
  return formatErrorCard(dataSource, error instanceof Error ? error.message : "Format error");
}
}
