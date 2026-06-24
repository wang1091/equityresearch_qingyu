/**
 * Express route for the LLM fallback: /gemini-fallback. Registered on the API
 * router by routes.ts (mirrors registerStockPickerRoutes / etc.). Tries Gemini
 * (2.5-flash with Google Search grounding), then Perplexity (sonar-pro), and
 * renders the model text into an HTML card. The 4 prompt/fetch/render helpers
 * move with it (gemini-fallback-only).
 *
 * Extracted verbatim from routes.ts (per-domain split) — no behavior change.
 * Behavior pinned by L1 (route table) and L2 (routes/gemini.test.ts).
 */
import type { Router } from "express";
import { logger, SERVER_CONFIG } from "../utils";
import { getPerplexityKey } from "./_shared";
import {
  callChatWithFailover,
  geminiSearchProvider,
  perplexityChatProvider,
  type ChatProvider,
} from "../llm/chat";

/** Prompt for structured JSON — used by Gemini Search and Perplexity in /api/gemini-fallback */
function buildGeminiFallbackPrompt(query: string, isZh: boolean): string {
  return isZh
    ? `你是一位专业的股票研究分析师。请使用 Google 搜索获取最新数据，然后对以下问题提供结构化的专业分析。

用户问题：${query}

请先搜索最新相关信息，再基于搜索结果输出分析。严格按照以下 JSON 格式输出，不要输出任何其他内容，不要使用 Markdown 代码块：

{
  "summary": "2-3句话的核心结论，引用最新搜索数据（使用<strong>标签高亮关键数字和词语）",
  "key_insights": [
    "洞察1（一句话，引用具体数据）",
    "洞察2",
    "洞察3"
  ],
  "reasoning": "3-5句话的详细分析推理，说明数据来源（使用<strong>标签，禁止Markdown）",
  "conclusion": "1-2句话的明确结论",
  "disclaimer": "⚠️ 本分析仅供参考，不构成投资建议。"
}`
    : `You are a professional equity research analyst. Use Google Search to find the latest data, then provide a structured analysis for the following question.

User question: ${query}

Search for the most current information first, then base your analysis on those search results. Output ONLY valid JSON in exactly this format, no markdown fences, no extra text:

{
  "summary": "2-3 sentence core conclusion citing the latest search data (use <strong> tags to highlight key numbers and terms)",
  "key_insights": [
    "Insight 1 (one sentence, cite specific data from search results)",
    "Insight 2",
    "Insight 3"
  ],
  "reasoning": "3-5 sentences of detailed reasoning referencing data sources (use <strong> tags, no Markdown)",
  "conclusion": "1-2 sentence clear verdict",
  "disclaimer": "⚠️ This analysis is for informational purposes only and does not constitute financial advice."
}`;
}

function renderGeminiFallbackFromModelText(text: string, isZh: boolean, source: "gemini" | "perplexity" = "gemini"): string {
  let cleanedInput = text.replace(/^```(?:json|html)?\s*/i, "").replace(/```\s*$/, "").trim();
  const label = source === "gemini"
    ? (isZh ? "Gemini 搜索分析" : "Gemini Search Analysis")
    : (isZh ? "Perplexity 兜底分析" : "Perplexity Fallback Analysis");

  try {
    const parsed = JSON.parse(cleanedInput);
    const insightsHtml = Array.isArray(parsed.key_insights)
      ? parsed.key_insights.map((ins: string) =>
          `<div style="display:flex;gap:8px;margin-bottom:6px;"><span style="color:#3b82f6;flex-shrink:0;">•</span><span>${ins}</span></div>`
        ).join("")
      : "";

    return `<div style="font-size:0.85em;">
          <div style="font-weight:700;font-size:1em;margin-bottom:10px;">🔮 ${label}</div>

          <div style="background:#eff6ff;border-left:3px solid #3b82f6;padding:10px 12px;border-radius:6px;margin-bottom:12px;line-height:1.6;">
            ${parsed.summary || ""}
          </div>

          ${insightsHtml ? `<div style="font-weight:600;font-size:0.9em;color:#374151;margin-bottom:6px;text-transform:uppercase;letter-spacing:0.05em;">${isZh ? "核心洞察" : "Key Insights"}</div>
          <div style="margin-bottom:12px;line-height:1.6;color:#374151;">${insightsHtml}</div>` : ""}

          <div style="font-weight:600;font-size:0.9em;color:#374151;margin-bottom:6px;text-transform:uppercase;letter-spacing:0.05em;">${isZh ? "分析推理" : "Reasoning"}</div>
          <div style="margin-bottom:12px;line-height:1.6;color:#374151;">${parsed.reasoning || ""}</div>

          <div style="background:#f0fdf4;border-left:3px solid #22c55e;padding:10px 12px;border-radius:6px;margin-bottom:10px;line-height:1.6;">
            <strong>${isZh ? "结论" : "Conclusion"}:</strong> ${parsed.conclusion || ""}
          </div>

          <div style="font-size:0.8em;color:#9ca3af;">${parsed.disclaimer || ""}</div>
        </div>`;
  } catch {
    const cleaned = cleanedInput
      .replace(/^#{1,6}\s+/gm, "")
      .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
      .replace(/\*(.+?)\*/g, "$1")
      .replace(/^[\-\*]\s+/gm, "• ")
      .replace(/^\d+\.\s+/gm, "");
    return `<div style="font-size:0.85em;">
          <div style="font-weight:700;font-size:1em;margin-bottom:10px;">🔮 ${label}</div>
          <div style="line-height:1.7;color:#374151;">${cleaned}</div>
        </div>`;
  }
}

/** System instruction for the fallback chain — keeps Perplexity (and Gemini)
 *  output to the bare JSON the renderer expects. The user prompt already embeds
 *  the schema; this reinforces "no markdown / no extra text". */
function fallbackSystemPrompt(isZh: boolean): string {
  return isZh
    ? "你是一位专业的股票研究分析师。严格按照用户要求的 JSON 格式输出，不要多余文字或 Markdown 代码块。"
    : "You are a professional equity research analyst. Output ONLY valid JSON as requested, no markdown fences or extra text.";
}

/** Whether any fallback provider is configured. The route maps this to a 503. */
export function isGeminiFallbackConfigured(): boolean {
  return !!process.env.GEMINI_API_KEY || !!getPerplexityKey();
}

/**
 * Run the Gemini-Search → Perplexity fallback chain and return the rendered HTML
 * card, or null when no provider is configured / the chain is exhausted / the
 * model returned empty text. Shared by the /gemini-fallback route AND
 * generator.ts's last-resort path (which previously HTTP-proxied this route).
 *
 * Goes through the shared failover layer (server/llm/chat.ts): Gemini with
 * Google Search grounding first, then Perplexity. Only providers with a key join
 * the chain. A single per-attempt timeout (the larger former value) replaces the
 * per-provider timeouts; empty content from a non-last provider fails over.
 */
export async function runGeminiFallbackAnalysis(
  query: string,
  isZh: boolean,
): Promise<string | null> {
  const geminiKey = process.env.GEMINI_API_KEY;
  const perplexityKey = getPerplexityKey();

  const providers: ChatProvider[] = [];
  if (geminiKey) providers.push(geminiSearchProvider(geminiKey));
  if (perplexityKey) providers.push(perplexityChatProvider(perplexityKey, "sonar-pro"));
  if (providers.length === 0) return null;

  const prompt = buildGeminiFallbackPrompt(query, isZh);
  try {
    const { response, providerId } = await callChatWithFailover(
      providers,
      {
        messages: [
          { role: "system", content: fallbackSystemPrompt(isZh) },
          { role: "user", content: prompt },
        ],
        temperature: 0.3,
        max_tokens: 1500,
      },
      { timeoutMs: SERVER_CONFIG.PERPLEXITY_TIMEOUT },
    );
    const rawText = response.choices?.[0]?.message?.content?.trim() || null;
    if (!rawText) return null;
    const source = providerId === "perplexity" ? "perplexity" : "gemini";
    return renderGeminiFallbackFromModelText(rawText, isZh, source);
  } catch (chainError) {
    // All providers exhausted (HTTP error, timeout, …).
    logger.warn(
      `⚠️ gemini-fallback chain failed: ${chainError instanceof Error ? chainError.message : chainError}`,
    );
    return null;
  }
}

export function registerGeminiRoutes(apiRouter: Router): void {
  apiRouter.post("/gemini-fallback", async (req, res) => {
    logger.info("🔮 /api/gemini-fallback called");

    const { query, language } = req.body;

    if (!query || typeof query !== "string") {
      return res.status(400).json({ success: false, error: "query is required" });
    }

    const isZh = language === "zh";

    if (!isGeminiFallbackConfigured()) {
      return res.status(503).json({
        success: false,
        error: isZh
          ? "兜底分析未配置：请设置 GEMINI_API_KEY 或 PERPLEXITY_API_KEY"
          : "Fallback analysis unavailable: configure GEMINI_API_KEY or PERPLEXITY_API_KEY",
      });
    }

    try {
      const content = await runGeminiFallbackAnalysis(query, isZh);
      if (!content) {
        return res.status(502).json({
          success: false,
          error: isZh
            ? "无法生成分析（Gemini 搜索与 Perplexity 均不可用或返回空）。"
            : "Could not generate analysis (Gemini Search and Perplexity unavailable or empty).",
        });
      }
      return res.json({ success: true, content });
    } catch (error) {
      logger.error("❌ Gemini fallback error:", error);
      return res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });
}
