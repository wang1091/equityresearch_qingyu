// server/routes.ts
import type { Express } from "express";
import { createServer, type Server } from "node:http";
import { Router } from "express";
import { routeModules } from "./routes/registry";
import { probeUpstreams, summarizeHealth } from "./health";
import { handleCompetitiveAnalysis } from "./competitive/handler";
import { validateEnvironmentVariables, logger } from "./utils";





export async function registerRoutes(app: Express): Promise<Server> {
  const apiRouter = Router();

  console.log("📝 Registering API routes...");

  // ========== 测试路由 ==========
  apiRouter.get("/test", (req, res) => {
    logger.info("🎯 /api/test endpoint called");

    const requiredVars = validateEnvironmentVariables([
      "DEEPSEEK_API_KEY",
      "PERPLEXITY_API_KEY",
      "OPENAI_API_KEY",
    ]);

    res.json({
      message: "API is working!",
      timestamp: new Date().toISOString(),
      environment: {
        deepseek_configured: !!process.env.DEEPSEEK_API_KEY,
        perplexity_configured: !!process.env.PERPLEXITY_API_KEY,
        openai_configured: !!process.env.OPENAI_API_KEY,
        valuation_api_configured: !!process.env.VALUATION_API_URL,
      },
      requiredVariables: requiredVars,
    });
  });

  // Upstream health — probes the proxied services (classifier, smartnews,
  // stock-picker, valuation, performance, trending). Use after an EC2 restart
  // or as a load-balancer check. Always 200 if the app is up (so a transient
  // upstream blip doesn't get the instance killed); read `status`/`services`
  // for degraded/critical detail. 503 only when a CRITICAL upstream is down.
  apiRouter.get("/health", async (_req, res) => {
    const results = await probeUpstreams();
    const snapshot = summarizeHealth(results);
    res.status(snapshot.criticalDown ? 503 : 200).json({
      status: snapshot.status,
      timestamp: new Date().toISOString(),
      services: snapshot.services,
    });
  });

  // ========== 域路由模块（见 ./routes/registry.ts）==========
  routeModules.forEach((register) => register(apiRouter));

  // 一行委托,逻辑在 ./competitive/handler.ts
  apiRouter.post("/competitive-analysis", handleCompetitiveAnalysis);

  // ========== Agent聊天API ==========
  apiRouter.post("/agent/chat", async (req, res) => {
    logger.info("🤖 /api/agent/chat called");

    try {
      const { conversationId, message, language } = req.body;

      // 验证必需字段
      if (!conversationId || typeof conversationId !== "string") {
        return res.status(400).json({
          success: false,
          error: "conversationId is required",
        });
      }

      if (!message || typeof message !== "string" || message.trim().length === 0) {
        return res.status(400).json({
          success: false,
          error: "message is required and must be non-empty",
        });
      }

      logger.info(`💬 Conversation: ${conversationId}, Message: "${message}", Language: ${language || "default"}`);

      // 动态导入agent模块
      const { chat } = await import("./agent/index");
      const { setConversationLanguage } = await import("./agent/conversation");

      // 如果前端传了语言信息，更新对话语言
      if (language && (language === "en" || language === "zh")) {
        setConversationLanguage(conversationId, language);
        logger.info(`🌐 设置对话语言: ${language}`);
      }

      // 调用Agent处理
      const result = await chat(conversationId, message);

      res.json(result);
    } catch (error) {
      logger.error("❌ Agent chat error:", error);
      res.status(500).json({
        success: false,
        error: "Failed to process chat message",
        details: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });

  // ========== Agent生成回答API（仅生成回答，不调用API）==========
  apiRouter.post("/agent/generate-answer", async (req, res) => {
    logger.info("💬 /api/agent/generate-answer called");

    try {
      const { conversationId, query, apiResults, intent, language } = req.body;

      // 验证必需字段
      if (!conversationId || typeof conversationId !== "string") {
        return res.status(400).json({
          success: false,
          error: "conversationId is required",
        });
      }

      if (!query || typeof query !== "string" || query.trim().length === 0) {
        return res.status(400).json({
          success: false,
          error: "query is required and must be non-empty",
        });
      }

      logger.info(`🎯 Query: "${query}", Language: ${language || "default"}`);
      logger.info(`📦 API Results: ${apiResults ? Object.keys(apiResults).join(", ") : "none"}`);

      // 动态导入所需模块
      const { generateAnswerStream } = await import("./agent/generator");
      const { addMessage, getRecentMessages, setConversationLanguage, getConversationLanguage } = await import("./agent/conversation");

      // 如果前端传了语言信息，更新对话语言
      if (language && (language === "en" || language === "zh")) {
        setConversationLanguage(conversationId, language);
        logger.info(`🌐 设置对话语言: ${language}`);
      }

      // 1. 添加用户消息到历史
      addMessage(conversationId, "user", query);

      // 2. 获取对话历史
      const history = getRecentMessages(conversationId, 10);

      // 3. 获取对话语言
      const conversationLanguage = getConversationLanguage(conversationId);

      // 4. 生成回答
      const answer = await generateAnswerStream(
        query,
        apiResults || null,
        history,
        (chunk) => chunk, // 不流式输出，直接返回完整内容
        conversationLanguage
      );

      // 5. 保存助手回复到历史
      addMessage(conversationId, "assistant", answer);

      logger.success(`✅ Answer generated (${answer.length} chars)`);

      res.json({
        success: true,
        answer: answer,
        conversationId,
        metadata: {
          requiredData: intent?.required_data || [],
          tickers: intent?.tickers || [],
        },
      });
    } catch (error) {
      logger.error("❌ Generate answer error:", error);
      res.status(500).json({
        success: false,
        error: "Failed to generate answer",
        details: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });

  // ========== News Brief（专用端点，非流式 JSON）==========
  // 意图已知（NEWS_BRIEF），客户端直接带上现成的 newsContent 调用 —— 不分类、
  // 不调数据 API。取代旧的"借 /agent/chat-stream + preClassification 夹带
  // newsContext"做法（那条会让客户端操控路由）。输出是结构化 JSON、需完整才能
  // 渲染成卡片，所以无需流式（前端本来也不逐字渲染）。
  apiRouter.post("/agent/news-brief", async (req, res) => {
    logger.info("📊 /api/agent/news-brief called");

    try {
      const { newsContent, ticker, sources, citations, language } = req.body;

      if (!newsContent || typeof newsContent !== "string" || newsContent.trim().length === 0) {
        return res.status(400).json({
          success: false,
          error: "newsContent is required and must be non-empty",
        });
      }

      const resolvedLanguage: "en" | "zh" = language === "zh" ? "zh" : "en";

      const { generateAnswerStream } = await import("./agent/generator");
      // NEWS_BRIEF path ignores query/apiData/history/onChunk and returns the
      // brief as a JSON string (server-built specialMode — never client-supplied).
      const briefJson = await generateAnswerStream(
        ticker ? `${ticker} news brief` : "news brief",
        null,
        [],
        () => {},
        resolvedLanguage,
        {
          type: "NEWS_BRIEF",
          context: { newsContent, ticker: ticker ?? null, sources, citations },
        },
      );

      try {
        const brief = JSON.parse(briefJson);
        return res.json({ success: true, brief });
      } catch {
        // Generator returned non-JSON — surface raw so the client falls back to text.
        return res.json({ success: false, error: "brief is not valid JSON", raw: briefJson });
      }
    } catch (error) {
      logger.error("❌ News brief error:", error);
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });

  // ========== Agent流式聊天API（真正的实时流式）==========
  apiRouter.post("/agent/chat-stream", async (req, res) => {
    logger.info("🤖 /api/agent/chat-stream called");

    try {
      const { conversationId, message, /* classification (DISABLED — see below), */ language } = req.body;

      // 验证必需字段
      if (!conversationId || typeof conversationId !== "string") {
        return res.status(400).json({
          success: false,
          error: "conversationId is required",
        });
      }

      if (!message || typeof message !== "string" || message.trim().length === 0) {
        return res.status(400).json({
          success: false,
          error: "message is required and must be non-empty",
        });
      }

      logger.info(`💬 Stream Conversation: ${conversationId}, Message: "${message}", Language: ${language || "default"}`);

      // preClassification 已禁用：不再读取/信任 req.body.classification,后端统一分类。
      // News Brief 改用 POST /api/agent/news-brief。
      // if (classification) {
      //   logger.info(`📋 使用前端分类结果，跳过重复分类`);
      // }

      // 设置流式响应头
      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");
      res.setHeader("X-Accel-Buffering", "no"); // 禁用 Nginx 缓冲

      // 客户端断开（关闭页面/标签）时取消下游 LLM 调用，停止烧 token。
      const clientAbort = new AbortController();
      res.on("close", () => {
        if (!res.writableEnded) {
          clientAbort.abort("client_disconnect");
        }
      });

      // 动态导入agent模块
      const { chatStream } = await import("./agent/index");
      const { setConversationLanguage } = await import("./agent/conversation");

      // 确定响应语言：优先使用前端传入的 language，其次检测消息文本是否含中文
      const hasChinese = /[\u4e00-\u9fff]/.test(message);
      const resolvedLanguage: "en" | "zh" =
        language === "zh" || (!language && hasChinese) ? "zh" : "en";
      setConversationLanguage(conversationId, resolvedLanguage);
      logger.info(`🌐 设置对话语言: ${resolvedLanguage} (frontend: ${language || "none"}, hasChinese: ${hasChinese})`);

      // ✅ 调用Agent流式处理，传递分类结果（如果有）
      const result = await chatStream(
        conversationId,
        message,
        (chunk: string) => {
          // 每次收到DeepSeek生成的块，立即发送给前端
          res.write(`data: ${JSON.stringify({
            type: "content",
            chunk,
            done: false
          })}\n\n`);
          // 立即刷新缓冲区，强制发送数据
          if (typeof (res as any).flush === 'function') {
            (res as any).flush();
          }
        },
        (toolInfo) => {
          // 每次工具调用时，发送工具调用信息到前端
          res.write(`data: ${JSON.stringify({
            type: "tool_call",
            ...toolInfo
          })}\n\n`);
          // 立即刷新缓冲区
          if (typeof (res as any).flush === 'function') {
            (res as any).flush();
          }
        },
        undefined, // preClassification DISABLED (was req.body.classification): client-controlled routing; backend classifies once. News Brief → /api/agent/news-brief. Re-enable: restore req.body destructure + this arg + the branch in agent/index.ts.
        (event) => {
          // Typed structured payloads (e.g. news_v2). Forwarded as SSE
          // events distinct from text content so the frontend can route
          // them to dedicated React components.
          res.write(`data: ${JSON.stringify(event)}\n\n`);
          if (typeof (res as any).flush === 'function') {
            (res as any).flush();
          }
        },
        clientAbort.signal,
      );

      if (!result.success) {
        res.write(`data: ${JSON.stringify({ type: "error", error: result.error })}\n\n`);
        res.end();
        return;
      }

      // 发送完成信号和元数据
      res.write(`data: ${JSON.stringify({
        type: "done",
        metadata: result.metadata,
        conversationId: result.conversationId
      })}\n\n`);

      res.end();
    } catch (error) {
      logger.error("❌ Agent stream error:", error);
      res.write(`data: ${JSON.stringify({
        type: "error",
        error: error instanceof Error ? error.message : "Unknown error"
      })}\n\n`);
      res.end();
    }
  });

  app.use("/api", apiRouter);
  app.use("/data", apiRouter);

  const httpServer = createServer(app);

  return httpServer;
}
