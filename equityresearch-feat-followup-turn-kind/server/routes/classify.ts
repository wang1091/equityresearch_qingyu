/**
 * Express route for multi-intent classification: /classify-intents-multi.
 * Registered on the API router by routes.ts (mirrors registerStockPickerRoutes /
 * etc.). Delegates to agent/classifier (direct call, no HTTP loop) with a
 * keyword fallback on error.
 *
 * Extracted verbatim from routes.ts (per-domain split) — no behavior change.
 * Behavior pinned by L1 (route table) and L2 (routes/classify.test.ts).
 */
import type { Router } from "express";
import { logger, validateRequired, errorResponse } from "../utils";
import { classifyIntents, buildKeywordFallback, resolveClassifierLlm } from "../agent/classifier";
import { getDeepSeekKey } from "./_shared";

export function registerClassifyRoutes(apiRouter: Router): void {
  apiRouter.post("/classify-intents-multi", async (req, res) => {
    try {
      const { query, conversationHistory = [], language = "en" } = req.body;

      const validation = validateRequired(req.body, ["query"]);
      if (!validation.valid) {
        return res.status(400).json(errorResponse(validation.error));
      }
      if (typeof query !== "string" || query.trim().length === 0) {
        return res.status(400).json(
          errorResponse("Query must be a non-empty string"),
        );
      }
      // The classifier can run on a local OpenAI-compatible endpoint
      // (CLASSIFIER_LLM_BASE_URL — Ollama / LM Studio / vLLM) with no DeepSeek
      // key. Only require a DeepSeek key when the classifier would actually fall
      // back to hosted DeepSeek (the default base); otherwise this guard would
      // 500 a perfectly working local-LLM setup before classifyIntents runs.
      if (resolveClassifierLlm().isDefaultDeepSeek && !getDeepSeekKey()) {
        return res.status(500).json({
          success: false,
          error: "DeepSeek API key not configured",
        });
      }

      // 分类逻辑已抽到 agent/classifier.ts，内部调用走直连不再回环 HTTP
      const result = await classifyIntents(query, conversationHistory, language);
      res.json(result);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      logger.warn("classifier.fallback", { cause: "route_error", reason: msg });
      res.json(buildKeywordFallback(req.body.query || ""));
    }
  });

}
