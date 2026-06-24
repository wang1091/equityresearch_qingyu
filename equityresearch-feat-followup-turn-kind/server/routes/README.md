# API 端点总览

所有端点都同时挂载在 **`/api/*`** 和 **`/data/*`** 两个前缀下(`routes.ts` 末尾 `app.use("/api", apiRouter)` + `app.use("/data", apiRouter)`)。下表路径省略前缀。

> 这份清单是**人读总览**;机器可验证的真相源是 `server/tests/routes.smoke.test.ts` 的 `EXPECTED_ROUTES`(43 条 golden,增删端点会让它变红)。两者如有出入,以测试为准。
>
> 测试统一放在 `server/tests/`(`tests/routes/`、`tests/agent/` 镜像源码结构)。
>
> 注册入口:`routes.ts` → `routeModules`(见 `routes/registry.ts`)逐个 `register…(apiRouter)`;`/test`、`/health`、`/competitive-analysis`、`/agent/*` 内联在 `routes.ts`。
>
> 配置来源:内部服务 base URL → `server/upstreamConfig.ts`(env 驱动);外部 vendor host → `server/config/providers.ts`;LLM key → `routes/_shared.ts`;超时 → `SERVER_CONFIG`(`server/utils.ts`)。

| 模块文件 | 方法 + 路径 | 说明 | 上游 / 依赖 |
|---|---|---|---|
| `routes.ts`(内联) | `GET /test` | 环境变量自检 | — |
| `routes.ts`(内联) | `GET /health` | 上游健康探测(critical down → 503) | `health.ts` 探测各上游 |
| `routes.ts`(内联) | `POST /competitive-analysis` | 波特五力分析(一行委托) | `competitive/handler.ts` |
| `routes.ts`(内联) | `POST /agent/chat` | Agent 非流式对话 | `agent/index.ts` |
| `routes.ts`(内联) | `POST /agent/generate-answer` | 仅生成回答(不取数) | `agent/generator.ts` |
| `routes.ts`(内联) | `POST /agent/chat-stream` | Agent SSE 流式对话 | `agent/index.ts`(SSE) |
| `chatHistory.ts` | `GET /chat-history` | 会话列表 | Postgres |
| `chatHistory.ts` | `GET /chat-history/:conversationId` | 单会话历史 | Postgres |
| `chatHistory.ts` | `POST /chat-history` | 新建会话 | Postgres |
| `chatHistory.ts` | `DELETE /chat-history/:conversationId` | 删除会话 | Postgres |
| `chatHistory.ts` | `GET /me` | 当前用户 | — |
| `stockPicker/routes.ts` | `POST /stock-picker/query` | 选股器代理 | StockPicker 上游 |
| `routes/marketData.ts` | `POST /market-data` | 实时行情(FMP→Yahoo) | `marketData/marketDataService` |
| `routes/marketData.ts` | `POST /detect-market-data` | 实时行情意图检测 | `marketData/stockQueryDetector`(纯) |
| `routes/trending.ts` | `GET /trending-stocks` | 热门股(可带 `?category=`) | Trending 上游 |
| `routes/translate.ts` | `POST /translate-visible-content` | 前端可见内容翻译 | `translation` 服务 |
| `routes/classify.ts` | `POST /classify-intents-multi` | 多意图分类（**test/diagnostic only** — 不在生产前端请求路径上：聊天流内部进程内分类并经 SSE `classification` 事件下发；本端点仅供 `scripts/routing/*` 路由测试与手工排障 curl 单独跑分类器） | `agent/classifier` + DeepSeek key |
| `routes/valuation.ts` | `POST /valuation-analysis` | DCF 估值 | Python 估值服务(`VALUATION_API_URL`) |
| `routes/redflags.ts` | `POST /analyze-redflags` | 新闻红旗打分 | DeepSeek |
| `routes/fda.ts` | `GET /fda/companies/:ticker` | FDA 公司试验 | FDA 上游 |
| `routes/fda.ts` | `GET /fda/companies` | FDA 公司列表 / `?company=` 搜索 | FDA 上游 |
| `routes/earnings.ts` | `POST /summarize-earnings` | 财报摘要 | DeepSeek |
| `routes/earnings.ts` | `POST /earnings-fallback` | 财报兜底分析 | DeepSeek |
| `routes/earnings.ts` | `POST /earnings/ask` | 财报问答 | SmartNews + transcript QA |
| `routes/earnings.ts` | `GET /earnings/calendar` | Nasdaq 财报日历 | `earnings/nasdaqCalendar` |
| `routes/earnings.ts` | `POST /earnings/query` | 统一财报查询 | SmartNews + DeepSeek |
| `routes/recommend.ts` | `POST /recommend-stocks` | 行业选股推荐 | Perplexity(sonar-pro) |
| `routes/qa.ts` | `POST /general-qa` | 通用问答 | Perplexity(sonar) |
| `routes/quotes.ts` | `GET /stock-detail/:ticker` | 个股详情(基本面) | Yahoo quoteSummary |
| `routes/quotes.ts` | `GET /stock-price/:ticker` | 股价 + 走势图 | Yahoo chart + FMP |
| `routes/quotes.ts` | `GET /similar-stocks/:ticker` | 同类股 | Yahoo recommendations |
| `routes/quotes.ts` | `GET /analyst-ratings/:ticker/detail` | 分析师评级(详版) | Yahoo insights + chart |
| `routes/quotes.ts` | `GET /analyst-ratings/:ticker` | 分析师评级(简版) | Yahoo insights + chart |
| `routes/performance.ts` | `POST /performance/resolve` | 公司名→ticker | Python 性能服务 |
| `routes/performance.ts` | `POST /performance/find-peers` | 同行公司 | Python 性能服务 |
| `routes/performance.ts` | `POST /performance/get-metrics` | 财务指标 | Python 性能服务 |
| `routes/performance.ts` | `POST /performance/peer-analysis` | 同行对比分析 | Python 性能服务 |
| `routes/performance.ts` | `GET /performance/company-analysis` | 一站式公司分析 | Python 性能服务 |
| `routes/performance.ts` | `GET /performance/health` | 性能服务健康检查 | Python 性能服务 |
| `routes/rumor.ts` | `POST /rumor-check/chatbot` | 传闻核查 | Rumor 上游 + legacy fallback |
| `routes/rumor.ts` | `POST /detect-rumor` | 传闻核查(向后兼容别名) | 同上 |
| `routes/gemini.ts` | `POST /gemini-fallback` | LLM 兜底(Gemini→Perplexity) | Gemini + Perplexity |
| `routes/followups.ts` | `POST /follow-ups` | 追问引擎 | DeepSeek |

共 **43** 个端点(× `/api` 与 `/data` 两个前缀)。
