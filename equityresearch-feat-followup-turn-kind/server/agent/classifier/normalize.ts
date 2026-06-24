// server/agent/classifier/normalize.ts
// Deterministic post-processing of the raw LLM JSON: keyword fallback,
// whitelist filtering, ticker normalization (ADR map), earnings-calendar
// coercion, ticker-required pruning. Pure functions, no network.
import { logger } from "../../utils";
import { filterValidDataSources } from "../intentSources";
import { FDA_COMPANY_ALIASES } from "../../config/fdaAliases";
import { normalizeEarningsRouting } from "../../earnings/routingPolicy";
import {
  looksLikeEarningsCalendarQuery,
  looksLikeEarningsCalendarForTicker,
  resolveCalendarDateFromQuery,
} from "../../../shared/earnings";
import { resolveReturnWindow } from "../../../shared/returnWindow";
import { hasHistoricalFundamentalsModifier } from "./fundamentalsRouting";
import { parseValidCandidates } from "../taskPlanning/schema";
import type { ClassificationResult } from "./types";

export function buildKeywordFallback(query: string): ClassificationResult {
  const lq = query.toLowerCase();
  // Extract ticker — stock tickers in queries are typically 2-5 uppercase letters
  // that are NOT common English words. We pick the first candidate.
  const COMMON_WORDS = new Set(["THE","AND","FOR","ARE","BUT","NOT","YOU","ALL","CAN","HER","WAS","ONE","OUR","OUT","DAY","GET","HAS","HIM","HIS","HOW","ITS","NEW","NOW","OLD","SEE","TWO","WAY","WHO","CALL","WILL","FROM","HAVE","BEEN","THAT","THIS","WHAT","WITH","MORE","SOME","TIME","VERY","WHEN","WERE","THEY","THEN","THAN","ALSO","INTO","JUST","LIKE","MOST","OVER","SAID","SUCH","WELL","YOUR","BOTH","EACH","EVEN","MANY","MUCH","SAME","TAKE","TELL","TURN","COME","DOES","DOWN","FIND","GIVE","GOOD","HERE","HOLD","KEEP","KNOW","LAST","LONG","LOOK","MADE","MAKE","MEAN","MUCH","NAME","NEED","NEXT","ONLY","OPEN","PART","PLACE","PLAN","PLAY","SHOW","SIDE","STOP","TALK","THEM","THESE","THINK","THOSE","WANT","WORK","YEAR","BEST","FALL","FREE","FULL","HIGH","LATE","LESS","LIVE","LOVE","PAST","PICK","PLAN","PULL","PUSH","REAL","REST","RISE","ROLE","RULE","SELL","SEND","SIGN","STEP","SURE","TASK","TEAM","TEST","THUS","TILL","TINY","TOLD","TOOK","TOPS","TOTAL","TRADE","TRUE","TYPE","UNIT","UPON","USER","USED","USING","VALU","VIEW","WAIT","WALK","WARM","WAYS","WEAK","WEEK","WENT","WIDE","WILD","WIND","WISE","WITH","WORD","WORE","WORN","WRAP"]);
  const tickerMatch = query.toUpperCase().match(/\b([A-Z]{1,5})\b/g);
  const ticker = tickerMatch?.find(t => t.length >= 2 && t.length <= 5 && !COMMON_WORDS.has(t)) || null;
  const tickers = ticker ? [ticker] : [];

  let intent = "GENERAL";
  let apiParams: Record<string, any> = {};
  if (lq.includes("news") || lq.includes("新闻")) {
    intent = "NEWS"; apiParams = { NEWS: { query } };
  } else if (lq.includes("earnings calendar") || lq.includes("upcoming earnings") || lq.includes("财报日历") || lq.includes("即将财报")) {
    intent = "EARNINGS"; apiParams = { EARNINGS: { topic: "upcoming" } };
  } else if (lq.includes("trending") || lq.includes("most active") || lq.includes("top gainer") || lq.includes("top loser") || lq.includes("热门股") || lq.includes("涨幅最大") || lq.includes("跌幅最大")) {
    intent = "TRENDING"; apiParams = { TRENDING: { category: "all" } };
  } else if (lq.includes("earnings") || lq.includes("财报")) {
    intent = "EARNINGS";
    apiParams = { EARNINGS: { topic: "transcript_qa", question: query, ...(ticker ? { ticker } : {}) } };
  } else if (lq.includes("valuation") || lq.includes("估值")) {
    intent = "VALUATION"; apiParams = { VALUATION: { ...(ticker ? { ticker } : {}) } };
  } else if (lq.includes("price") || lq.includes("股价")) {
    intent = "STOCK_PRICE"; apiParams = { STOCK_PRICE: { ...(ticker ? { ticker } : {}) } };
  } else if (lq.includes("performance") || lq.includes("财务")) {
    intent = "PERFORMANCE"; apiParams = { PERFORMANCE: { ...(ticker ? { ticker } : {}) } };
  } else if (lq.includes("competitive") || lq.includes("竞争")) {
    intent = "COMPETITIVE"; apiParams = { COMPETITIVE: { ...(ticker ? { ticker } : {}) } };
  }
  return {
    success: true, query,
    required_data: [intent], primary_focus: intent, intents: [intent],
    tickers, need_api: intent !== "GENERAL", confidence: 0.6,
    reasoning: "Keyword fallback: DeepSeek unavailable",
    api_params: apiParams,
    // Single-intent keyword guess — multi-intent queries are degraded here. Flag
    // it so downstream doesn't treat this as a clean classification (bug 005, L3).
    degraded: true,
  };
}


/** Deterministic normalization of the parsed LLM result into a ClassificationResult. */
export function normalizeClassifierResult(
  result: any,
  ctx: { query: string; dateString: string },
): ClassificationResult {
  const { query, dateString } = ctx;
      // 验证和清理结果：用统一白名单过滤 LLM 输出（见 agent/intentSources.ts）
      // 新格式：required_data（优先）
      let requiredData: string[] = filterValidDataSources(result.required_data);

      // 向后兼容：如果返回的是旧格式的 intents，也接受
      if (requiredData.length === 0) {
        requiredData = filterValidDataSources(result.intents);
      }

      // 单个intent字段的兼容
      if (requiredData.length === 0 && result.intent) {
        requiredData = [result.intent];
      }

      // 默认值
      if (requiredData.length === 0) {
        requiredData = ["GENERAL"];
      }

      // 获取主要焦点
      let primaryFocus = result.primary_focus || requiredData[0] || "GENERAL";
      const fdaCompanyAlias = requiredData.includes("FDA")
        ? Object.entries(FDA_COMPANY_ALIASES).find(([alias]) => query.includes(alias))?.[1]
        : undefined;
      const fdaParams = result.api_params && typeof result.api_params === "object"
        ? (result.api_params as any).FDA
        : undefined;
      const hasFdaCompanyParam =
        fdaParams &&
        !Array.isArray(fdaParams) &&
        typeof fdaParams.companyName === "string" &&
        fdaParams.companyName.trim().length > 0;
      // FDA primary_focus now comes from the classifier (A4): the prompt gained
      // worked FDA examples (pure FDA → primary FDA; FDA+news → NEWS), so the
      // old keyword force here was removed. The company-alias mapping below
      // (data lookup the LLM lacks) stays. See docs/LLM_TS_DUPLICATION_INVENTORY.md.

      // 确保 tickers 是数组并验证格式
      let tickers = Array.isArray(result.tickers) ? result.tickers : [];
      if (result.ticker && !tickers.includes(result.ticker)) {
        tickers = [result.ticker];
      }

      // Ticker 格式验证和清理
      tickers = tickers
        .map((t: string) => String(t).toUpperCase().trim())
        .filter((t: string) => /^[A-Z]{1,5}$/.test(t));

      // ✅ 中国公司美股 ADR 映射表（修正常见错误）
      const CHINA_ADR_MAP: { [key: string]: string } = {
        "BYD": "BYDDY",      // 比亚迪
        "BIDU": "BIDU",      // 百度（已正确）
        "BABA": "BABA",      // 阿里巴巴（已正确）
        "JD": "JD",          // 京东（已正确）
        "PDD": "PDD",        // 拼多多（已正确）
        "NIO": "NIO",        // 蔚来（已正确）
        "LI": "LI",          // 理想（已正确）
        "XPEV": "XPEV",      // 小鹏（已正确）
        "NTES": "NTES",      // 网易
        "TME": "TME",        // 腾讯音乐
      };

      // 应用映射到 tickers 数组
      tickers = tickers.map((t: string) => CHINA_ADR_MAP[t] || t);

      // ✅ 同时应用映射到 api_params 中的所有 ticker 字段
      if (result.api_params && typeof result.api_params === 'object') {
        for (const [source, params] of Object.entries(result.api_params)) {
          if (Array.isArray(params)) {
            // 处理数组形式的params（多ticker场景）
            params.forEach((item: any) => {
              if (item && typeof item === 'object') {
                if (item.ticker && typeof item.ticker === 'string') {
                  const mappedTicker = CHINA_ADR_MAP[item.ticker.toUpperCase()] || item.ticker;
                  item.ticker = mappedTicker;
                }
                if (Array.isArray(item.tickers)) {
                  item.tickers = item.tickers.map((t: string) =>
                    CHINA_ADR_MAP[t.toUpperCase()] || t
                  );
                }
              }
            });
          } else if (params && typeof params === 'object') {
            const p = params as any;
            // 处理单个 ticker 字段
            if (p.ticker && typeof p.ticker === 'string') {
              const mappedTicker = CHINA_ADR_MAP[p.ticker.toUpperCase()] || p.ticker;
              p.ticker = mappedTicker;
            }
            // 处理 tickers 数组字段
            if (Array.isArray(p.tickers)) {
              p.tickers = p.tickers.map((t: string) =>
                CHINA_ADR_MAP[t.toUpperCase()] || t
              );
            }
          }
        }
      }

      // Single-company calendar ("TSLA earnings calendar") — KEEP the ticker and
      // route to topic=calendar+ticker (service.ts hits the ticker schedule data
      // endpoint). Checked BEFORE the market-wide block, whose broad detector
      // would otherwise strip the ticker. Only when the LLM extracted exactly one.
      const llmTickers = Array.isArray(result.tickers)
        ? (result.tickers as unknown[]).map((t) => String(t).toUpperCase().trim()).filter(Boolean)
        : [];
      if (looksLikeEarningsCalendarForTicker(query) && llmTickers.length === 1) {
        requiredData = ["EARNINGS"];
        primaryFocus = "EARNINGS";
        result.primary_focus = "EARNINGS";
        tickers = [llmTickers[0]];
        result.tickers = [llmTickers[0]];
        result.need_api = true;
        if (!result.api_params || typeof result.api_params !== "object") {
          result.api_params = {};
        }
        (result.api_params as Record<string, unknown>).EARNINGS = {
          topic: "calendar",
          ticker: llmTickers[0],
        };
      } else if (looksLikeEarningsCalendarQuery(query)) {
        requiredData = ["EARNINGS"];
        primaryFocus = "EARNINGS";
        result.primary_focus = "EARNINGS";
        tickers = [];
        result.tickers = [];
        result.need_api = true;
        if (!result.api_params || typeof result.api_params !== "object") {
          result.api_params = {};
        }
        (result.api_params as Record<string, unknown>).EARNINGS = {
          topic: "calendar",
          date: resolveCalendarDateFromQuery(query, dateString),
        };
      }

      const earningsRouting = normalizeEarningsRouting({
        query,
        requiredData,
        tickers,
        apiParams:
          result.api_params && typeof result.api_params === "object"
            ? result.api_params
            : undefined,
      });
      result.api_params = earningsRouting.apiParams;

      // 需要ticker的数据源列表
      const DATA_REQUIRING_TICKER = [
        "COMPETITIVE",
        "STOCK_PRICE",
        "PEER_STOCKS",
        "RATING",
        "VALUATION",
        "EARNINGS",
        "PERFORMANCE",
        "FDA"
      ];

      const earningsApiParam = result.api_params?.EARNINGS;
      const earningsIsCalendar =
        !Array.isArray(earningsApiParam) &&
        earningsApiParam &&
        typeof earningsApiParam === "object" &&
        (earningsApiParam as { topic?: string }).topic === "calendar";

      // 统一处理需要ticker的数据源
      DATA_REQUIRING_TICKER.forEach(dataSource => {
        if (dataSource === "FDA" && (fdaCompanyAlias || hasFdaCompanyParam)) {
          return;
        }

        if (dataSource === "EARNINGS" && earningsIsCalendar) {
          return;
        }

        if (requiredData.includes(dataSource) && (!tickers || tickers.length === 0)) {
          console.warn(`⚠️ ${dataSource} without ticker detected, removing ${dataSource}`);
          requiredData = requiredData.filter((d: any) => d !== dataSource);
        }
      });

      if (fdaCompanyAlias && requiredData.includes("FDA")) {
        result.api_params = {
          ...(result.api_params && typeof result.api_params === "object" ? result.api_params : {}),
          FDA: {
            ...(fdaParams && !Array.isArray(fdaParams) ? fdaParams : {}),
            companyName: fdaCompanyAlias,
            query,
          },
        };
      }

      // 兜底：如果所有数据源都被移除，默认为 GENERAL
      // 同时把 need_api 复位为 false：原本的 true 是基于已被剥离的 ticker-required
      // 数据源（如 PEER_STOCKS），现在只剩 GENERAL 就不需要外部 API，应该走训练知识路径
      // 而不是落到 "no data retrieved → hard refusal"。
      if (requiredData.length === 0) {
        requiredData = ["GENERAL"];
        result.need_api = false;
      }

      // primary_focus 必须留在幸存的 required_data 里。strip 循环（上方）和
      // 兜底成 GENERAL 都只改 requiredData，不动 primaryFocus，会留下像
      // primary_focus:"EARNINGS" + required_data:["GENERAL"] 的脏状态，污染下游
      // triage / UI 判断。这里重新对齐到现存的最重要数据源。
      if (!requiredData.includes(primaryFocus)) {
        primaryFocus = requiredData[0] || "GENERAL";
      }

      // PERFORMANCE returns the LATEST quarter only (no date param), so a TIME-modified
      // fundamentals query silently mis-answers. TS owns time detection (the LLM is unreliable
      // at it); reroute to the EARNINGS transcript_qa RAG, sending the RAW question (smartnews
      // parses ticker/period itself). Runs before api_params cleanup so it keeps EARNINGS and
      // drops PERFORMANCE. (operating-KPI / qualitative routing is the LLM's job via prompt rules
      // — NOT re-judged here; a TS override would corrupt correct LLM calls. See
      // fundamentalsRouting.ts.)
      if (requiredData.includes("PERFORMANCE") && hasHistoricalFundamentalsModifier(query)) {
        requiredData = [...new Set(requiredData.map((d) => (d === "PERFORMANCE" ? "EARNINGS" : d)))];
        if (primaryFocus === "PERFORMANCE") primaryFocus = "EARNINGS";
        if (!result.api_params || typeof result.api_params !== "object") result.api_params = {};
        delete (result.api_params as Record<string, unknown>).PERFORMANCE;
        (result.api_params as Record<string, unknown>).EARNINGS = {
          topic: "transcript_qa",
          question: query,
          ...(tickers[0] ? { ticker: tickers[0] } : {}),
        };
        logger.info(`📚 PERFORMANCE→EARNINGS/transcript_qa reroute (time-modified fundamentals)`);
      }

      // ✅ 清理 api_params：只保留 required_data 中存在的数据源
      if (result.api_params && typeof result.api_params === 'object') {
        const cleanedParams: any = {};
        for (const key of requiredData) {
          if (result.api_params[key]) {
            cleanedParams[key] = result.api_params[key];
          }
        }
        result.api_params = cleanedParams;
      }

      // MARKET_DATA return windows: dates are TS-computed, never trusted from the LLM (a 9B
      // doing "6 months ago" arithmetic is the fragile link). When the query carries a
      // confident window phrase, override fromDate/toDate; preserve a historical queryType the
      // LLM picked (comparison/portfolio drive different math), else upgrade to return_calc.
      // No window parsed → leave the LLM's params as-is. See shared/returnWindow.ts.
      const mdParams = result.api_params?.MARKET_DATA;
      if (mdParams && typeof mdParams === "object" && !Array.isArray(mdParams)) {
        const window = resolveReturnWindow(query);
        if (window) {
          const HISTORICAL_TYPES = new Set(["return_calc", "portfolio", "comparison", "historical"]);
          mdParams.fromDate = window.fromDate;
          mdParams.toDate = window.toDate;
          if (!HISTORICAL_TYPES.has(mdParams.queryType)) mdParams.queryType = "return_calc";
        }
      }

      const confidence =
        typeof result.confidence === "number"
          ? Math.max(0, Math.min(1, result.confidence))
          : 0.7;

        const needApi =
          typeof result.need_api === "boolean" ? result.need_api : true;

        logger.info("✅ Multi-intent classification result:", {
          required_data: requiredData,
          primary_focus: primaryFocus,
          tickers,
          need_api: needApi,
          confidence,
        });

        // Phase 1 SHADOW (地基块 #4): keep the structurally-valid task candidates the
        // LLM emitted, RECORD-ONLY. Defensive — bad/absent tasks just yield undefined
        // and never affect the routing fields above. We ALSO surface rejectedCount so
        // the rejection rate is measurable (the script can't recover it from the
        // already-cleaned `tasks`). See taskPlanning/shadow.ts.
        const hasTasksField = Array.isArray(result.tasks);
        const { valid: shadowTasks, rejectedCount } = parseValidCandidates(result.tasks);
        if (rejectedCount > 0) {
          logger.warn("classifier.shadow_tasks_rejected", { rejected: rejectedCount, kept: shadowTasks.length });
        }

        return {
          success: true,
          query,
          required_data: requiredData,
          primary_focus: primaryFocus,
          intents: requiredData,
          tickers,
          need_api: needApi,
          confidence,
          reasoning: result.reasoning || "",
          api_params: result.api_params || {},
          ...(shadowTasks.length ? { tasks: shadowTasks } : {}),
          ...(hasTasksField ? { tasksRejectedCount: rejectedCount } : {}),
        };
}
