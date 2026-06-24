/**
 * Central registry of API route modules. Each entry registers its domain's
 * routes on the shared apiRouter; routes.ts just iterates this list. To add a
 * module, import it here and add it to the array — nothing else in routes.ts
 * changes.
 *
 * Registration order is cosmetic (all paths are distinct, no overlapping
 * patterns across modules). Infra endpoints (/test, /health), the one-line
 * /competitive-analysis delegate, and the agent/* SSE endpoints stay inline in
 * routes.ts.
 */
import type { Router } from "express";
import { registerChatHistoryRoutes } from "../chatHistory";
import { registerStockPickerRoutes } from "../stockPicker/routes";
import { registerMarketDataRoutes } from "./marketData";
import { registerTrendingRoutes } from "./trending";
import { registerTranslateRoutes } from "./translate";
import { registerClassifyRoutes } from "./classify";
import { registerValuationRoutes } from "./valuation";
import { registerRedflagsRoutes } from "./redflags";
import { registerFdaRoutes } from "./fda";
import { registerEarningsRoutes } from "./earnings";
import { registerRecommendRoutes } from "./recommend";
import { registerQaRoutes } from "./qa";
import { registerQuotesRoutes } from "./quotes";
import { registerPerformanceRoutes } from "./performance";
import { registerRumorRoutes } from "./rumor";
import { registerGeminiRoutes } from "./gemini";
import { registerFollowupsRoutes } from "./followups";

export const routeModules: ReadonlyArray<(apiRouter: Router) => void> = [
  registerChatHistoryRoutes,
  registerStockPickerRoutes,
  registerMarketDataRoutes,
  registerTrendingRoutes,
  registerTranslateRoutes,
  registerClassifyRoutes,
  registerValuationRoutes,
  registerRedflagsRoutes,
  registerFdaRoutes,
  registerEarningsRoutes,
  registerRecommendRoutes,
  registerQaRoutes,
  registerQuotesRoutes,
  registerPerformanceRoutes,
  registerRumorRoutes,
  registerGeminiRoutes,
  registerFollowupsRoutes,
];
