/**
 * Express route for the Follow-Up Engine: /follow-ups (DeepSeek prompt that
 * proposes the next research questions after the agent answers). Registered on
 * the API router by routes.ts (mirrors registerStockPickerRoutes / etc.).
 *
 * Extracted verbatim from routes.ts (per-domain split) — no behavior change.
 * Behavior pinned by L1 (route table) and L2 (routes/followups.test.ts).
 */
import type { Router } from "express";
import { logger, SERVER_CONFIG } from "../utils";
import { callChatWithFailover, resolveChatChain, httpStatusOf } from "../llm/chat";
import {
  buildFollowupsSystemPrompt,
  buildFollowupsUserMessage,
} from "./followupsPrompts";

export function registerFollowupsRoutes(apiRouter: Router): void {
  // ========== Follow-Up Engine ==========
  apiRouter.post("/follow-ups", async (req, res) => {
    const {
      user_question,
      agent_answer,
      ticker,
      available_data,
      conversation_history,
      language,
    } = req.body;

    if (!user_question || !agent_answer) {
      return res.status(400).json({ success: false, error: "user_question and agent_answer are required" });
    }

    const deepseekKey = process.env.DEEPSEEK_API_KEY;
    if (!deepseekKey) {
      return res.status(503).json({ success: false, error: "DEEPSEEK_API_KEY not configured" });
    }

    const promptInput = {
      user_question,
      agent_answer,
      ticker,
      available_data,
      conversation_history,
      language,
    };
    const systemPrompt = buildFollowupsSystemPrompt(promptInput);
    const userMsg = buildFollowupsUserMessage(promptInput);

    try {
      const { response } = await callChatWithFailover(
        resolveChatChain(),
        {
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userMsg },
          ],
          temperature: 0.4,
          max_tokens: 600,
        },
        { timeoutMs: SERVER_CONFIG.FOLLOWUPS_TIMEOUT },
      );

      const raw = response.choices?.[0]?.message?.content || "";
      const cleaned = raw.trim().replace(/^```json\s*/i, "").replace(/\s*```$/i, "");

      let parsed: any;
      try {
        parsed = JSON.parse(cleaned);
      } catch {
        logger.warn("Follow-up engine: JSON parse failed", { raw });
        return res.json({ success: true, follow_ups: [] });
      }

      const followUps = Array.isArray(parsed.follow_ups)
        ? parsed.follow_ups.filter((f: any) => f && typeof f.text === "string" && f.text.trim()).slice(0, 4)
        : [];

      return res.json({
        success: true,
        pillars_detected: parsed.pillars_detected || [],
        follow_ups: followUps,
      });
    } catch (error) {
      const upstreamStatus = httpStatusOf(error);
      if (upstreamStatus !== undefined) {
        logger.error("Follow-up engine LLM error", { status: upstreamStatus });
        return res.status(502).json({ success: false, error: "LLM call failed" });
      }
      logger.error("Follow-up engine error", { error });
      return res.status(500).json({ success: false, error: "Follow-up generation failed" });
    }
  });
}
