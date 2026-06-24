/**
 * Loading-phrase catalog + helpers.
 *
 * PURPOSE: this module exists ONLY to drive the animated "thinking…" phrase
 * shown while an answer is being generated (e.g. "Triangulating market signals…").
 * Nothing here affects real intent routing or the answer itself — routing is
 * owned by the backend classifier. These are cosmetic, per-module flavor words.
 *
 * Two ways a phrase kind is chosen:
 *   1. getActionLoadingKindFromIntentInfo() — once the backend's `classification`
 *      event has arrived, we theme the animation to the detected intent.
 *   2. getPreflightActionLoadingKind() — a lightweight client-side keyword guess
 *      used for the gap BEFORE the backend classification lands, so the very
 *      first frame of the animation already feels on-topic. It is intentionally
 *      best-effort; a wrong guess only mis-themes the spinner for a moment.
 */
import type { Message } from "@/types";
import type { UILanguage } from "@/utils/i18n";
import { looksLikeEarningsCalendarQuery } from "@shared/earnings";
import { looksLikeMarketValuationScreenQuery } from "@shared/stockPicker";

type LoadingWords = Record<UILanguage, { verbs: string[]; objects: string[] }>;

export type ActionLoadingKind =
  | "stockpicker"
  | "rumor"
  | "news"
  | "earnings"
  | "valuation"
  | "data"
  | "fda"
  | "competitive"
  | "price"
  | "rating"
  | "general";

const STOCK_PICKER_LOADING_WORDS: LoadingWords = {
  en: {
    verbs: [
      "Grokking",
      "Thinking through",
      "Calibrating",
      "Weighing",
      "Mapping",
      "Stress-testing",
      "Triangulating",
      "Scoring",
      "Parsing",
      "Synthesizing",
      "Cross-checking",
      "Ranking",
    ],
    objects: [
      "market signals",
      "sentiment shifts",
      "earnings clues",
      "valuation ranges",
      "risk flags",
      "financial strength",
      "price momentum",
      "engine outputs",
      "peer context",
      "confidence bands",
      "stock narratives",
      "final signals",
    ],
  },
  zh: {
    verbs: [
      "理解",
      "思考",
      "校准",
      "权衡",
      "映射",
      "压力测试",
      "交叉验证",
      "评分",
      "解析",
      "综合",
      "复核",
      "排序",
    ],
    objects: [
      "市场信号",
      "情绪变化",
      "财报线索",
      "估值区间",
      "风险标记",
      "财务强度",
      "价格动量",
      "引擎输出",
      "同业背景",
      "置信区间",
      "股票叙事",
      "最终信号",
    ],
  },
};

const RUMOR_LOADING_WORDS: LoadingWords = {
  en: {
    verbs: [
      "Checking",
      "Tracing",
      "Verifying",
      "Cross-checking",
      "Testing",
      "Reading",
      "Weighing",
      "Reconciling",
      "Scanning",
      "Grounding",
      "Comparing",
      "Validating",
    ],
    objects: [
      "source claims",
      "report timelines",
      "market chatter",
      "primary evidence",
      "contradictions",
      "news trails",
      "company signals",
      "deal language",
      "filing context",
      "confidence levels",
      "rumor paths",
      "verification notes",
    ],
  },
  zh: {
    verbs: [
      "核查",
      "追踪",
      "验证",
      "交叉验证",
      "测试",
      "阅读",
      "权衡",
      "对齐",
      "扫描",
      "溯源",
      "比较",
      "确认",
    ],
    objects: [
      "消息来源",
      "报道时间线",
      "市场传闻",
      "一手证据",
      "矛盾点",
      "新闻线索",
      "公司信号",
      "交易措辞",
      "公告背景",
      "置信水平",
      "传闻路径",
      "核实记录",
    ],
  },
};

const MODULE_LOADING_WORDS: Record<ActionLoadingKind, LoadingWords> = {
  stockpicker: STOCK_PICKER_LOADING_WORDS,
  rumor: RUMOR_LOADING_WORDS,
  news: {
    en: {
      verbs: ["Scanning", "Reading", "Triangulating", "Synthesizing", "Checking", "Tracking"],
      objects: ["news flow", "market catalysts", "headlines", "source context", "latest updates", "signal changes"],
    },
    zh: {
      verbs: ["扫描", "阅读", "交叉验证", "综合", "核对", "追踪"],
      objects: ["新闻流", "市场催化剂", "标题", "来源背景", "最新动态", "信号变化"],
    },
  },
  earnings: {
    en: {
      verbs: ["Parsing", "Reading", "Mapping", "Extracting", "Comparing", "Summarizing"],
      objects: ["earnings context", "call notes", "guidance signals", "analyst questions", "management tone", "quarterly clues"],
    },
    zh: {
      verbs: ["解析", "阅读", "梳理", "提取", "比较", "总结"],
      objects: ["财报背景", "会议记录", "指引信号", "分析师问题", "管理层语气", "季度线索"],
    },
  },
  valuation: {
    en: {
      verbs: ["Valuing", "Calibrating", "Stress-testing", "Comparing", "Discounting", "Weighing"],
      objects: ["price targets", "DCF ranges", "peer multiples", "upside scenarios", "valuation inputs", "risk assumptions"],
    },
    zh: {
      verbs: ["估算", "校准", "压力测试", "比较", "折现", "权衡"],
      objects: ["目标价", "DCF 区间", "同业倍数", "上行情景", "估值输入", "风险假设"],
    },
  },
  data: {
    en: {
      verbs: ["Crunching", "Benchmarking", "Normalizing", "Comparing", "Auditing", "Mapping"],
      objects: ["financial metrics", "growth trends", "margin signals", "balance sheet data", "peer ratios", "performance context"],
    },
    zh: {
      verbs: ["计算", "对标", "标准化", "比较", "审阅", "映射"],
      objects: ["财务指标", "增长趋势", "利润率信号", "资产负债表数据", "同业比率", "表现背景"],
    },
  },
  fda: {
    en: {
      verbs: ["Checking", "Scanning", "Mapping", "Reviewing", "Tracing", "Validating"],
      objects: ["FDA events", "approval timelines", "drug records", "regulatory signals", "recall data", "clinical catalysts"],
    },
    zh: {
      verbs: ["核查", "扫描", "梳理", "审阅", "追踪", "验证"],
      objects: ["FDA 事件", "审批时间线", "药品记录", "监管信号", "召回数据", "临床催化剂"],
    },
  },
  competitive: {
    en: {
      verbs: ["Mapping", "Benchmarking", "Comparing", "Sizing", "Testing", "Reading"],
      objects: ["competitive moats", "peer pressure", "industry forces", "market position", "strategic risks", "advantage signals"],
    },
    zh: {
      verbs: ["梳理", "对标", "比较", "衡量", "测试", "解读"],
      objects: ["竞争护城河", "同业压力", "行业力量", "市场位置", "战略风险", "优势信号"],
    },
  },
  price: {
    en: {
      verbs: ["Pulling", "Checking", "Reading", "Mapping", "Tracking", "Reconciling"],
      objects: ["price action", "market ticks", "volume moves", "session context", "quote data", "intraday signals"],
    },
    zh: {
      verbs: ["拉取", "核查", "读取", "映射", "追踪", "对齐"],
      objects: ["价格走势", "市场报价", "成交量变化", "交易时段背景", "行情数据", "盘中信号"],
    },
  },
  rating: {
    en: {
      verbs: ["Checking", "Comparing", "Reading", "Summarizing", "Weighing", "Mapping"],
      objects: ["analyst ratings", "target prices", "street revisions", "recommendation shifts", "rating context", "consensus signals"],
    },
    zh: {
      verbs: ["核查", "比较", "读取", "总结", "权衡", "映射"],
      objects: ["分析师评级", "目标价", "华尔街修正", "建议变化", "评级背景", "共识信号"],
    },
  },
  general: {
    en: {
      verbs: ["Thinking through", "Parsing", "Organizing", "Reasoning over", "Structuring", "Preparing"],
      objects: ["the request", "market context", "available evidence", "the answer", "research context", "next steps"],
    },
    zh: {
      verbs: ["思考", "解析", "组织", "推理", "构建", "准备"],
      objects: ["请求", "市场背景", "可用证据", "答案", "研究背景", "下一步"],
    },
  },
};

/**
 * Compose a single phrase by walking verbs/objects independently as `index`
 * ticks up, so the displayed phrase keeps changing while the answer streams.
 */
export const getLoadingPhrase = (
  wordsByLanguage: Record<UILanguage, { verbs: string[]; objects: string[] }>,
  language: UILanguage,
  index: number,
): string => {
  const words = wordsByLanguage[language];
  const verb = words.verbs[index % words.verbs.length];
  const object = words.objects[Math.floor(index / words.verbs.length) % words.objects.length];
  return language === "zh" ? `${verb}${object}` : `${verb} ${object}`;
};

/** Resolve the phrase set + words table for a given kind (falls back to general). */
export const getModuleLoadingWords = (kind: ActionLoadingKind): LoadingWords =>
  MODULE_LOADING_WORDS[kind] || MODULE_LOADING_WORDS.general;

/**
 * Theme the animation to the backend-detected intent. Returns null only when
 * no intents are present at all (e.g. before classification arrives).
 */
export const getActionLoadingKindFromIntentInfo = (
  intentInfo?: Message["intentInfo"],
): ActionLoadingKind | null => {
  const intents = intentInfo?.intents || [];
  for (const intent of intents) {
    const normalized = intent.toUpperCase();
    if (normalized.startsWith("STOCK_PICKER")) return "stockpicker";
    if (normalized === "RUMOR" || normalized === "RUMOR_CHECK") return "rumor";
    if (normalized === "NEWS" || normalized === "NEWS_DEFAULT" || normalized === "NEWS_BRIEF") return "news";
    if (normalized === "EARNINGS") return "earnings";
    if (normalized === "VALUATION") return "valuation";
    if (normalized === "PERFORMANCE") return "data";
    if (normalized === "FDA") return "fda";
    if (normalized === "COMPETITIVE" || normalized === "PEER_STOCKS") return "competitive";
    if (normalized === "STOCK_PRICE") return "price";
    if (normalized === "RATING") return "rating";
    if (normalized === "GENERAL") return "general";
  }
  return intents.length > 0 ? "general" : null;
};

export const isActionPhraseIntentInfo = (intentInfo?: Message["intentInfo"]): boolean =>
  Boolean(getActionLoadingKindFromIntentInfo(intentInfo));

/**
 * Best-effort client-side guess used only to pick a themed animation BEFORE the
 * backend classification event arrives. Real routing happens server-side; a
 * wrong guess here just mis-themes the spinner for a fraction of a second.
 */
export const getPreflightActionLoadingKind = (
  rawQuery: string,
  uiLanguage: UILanguage,
): ActionLoadingKind | null => {
  const query = rawQuery.trim();

  if (
    /\b(rumou?r|rumou?red|acquir(?:e|es|ing|ed)|takeover|merger|deal talk|hearing)\b/i.test(query) ||
    /谣言|传闻|收购|并购|是真的吗|是不是真的|是否属实/.test(query)
  ) {
    return "rumor";
  }

  if (looksLikeEarningsCalendarQuery(query)) {
    return "earnings";
  }

  if (/\b(news|headline|latest|jump|fell|drop|rally|catalyst|why did)\b/i.test(query) || /新闻|消息|为什么|上涨|下跌|催化/.test(query)) {
    return "news";
  }

  if (/\b(earnings?|revenue|eps|quarter|guidance|call summary|transcript)\b/i.test(query) || /财报|营收|利润|指引|电话会|会议记录/.test(query)) {
    return "earnings";
  }

  if (looksLikeMarketValuationScreenQuery(query)) {
    return "stockpicker";
  }

  if (/\b(valuation|value|undervalued|overvalued|dcf|price target|intrinsic)\b/i.test(query) || /估值|低估|高估|目标价|内在价值/.test(query)) {
    return "valuation";
  }

  if (/\b(fda|approval|approved|drug|clinical|trial|recall)\b/i.test(query) || /FDA|审批|批准|药物|临床|召回/.test(query)) {
    return "fda";
  }

  if (/\b(competitive|competition|competitor|moat|porter|industry|advantage)\b/i.test(query) || /竞争|对手|护城河|行业|优势|波特/.test(query)) {
    return "competitive";
  }

  if (/\b(price|quote|market cap|volume|trading at)\b/i.test(query) || /股价|报价|市值|成交量/.test(query)) {
    return "price";
  }

  if (/\b(rating|analyst|upgrade|downgrade|consensus)\b/i.test(query) || /评级|分析师|上调|下调|共识/.test(query)) {
    return "rating";
  }

  if (/\b(margin|roe|debt|cash flow|performance|financial metrics?)\b/i.test(query) || /利润率|现金流|负债|财务指标|表现/.test(query)) {
    return "data";
  }

  // Stock Picker routing now lives in the backend classifier, so the preflight
  // heuristic no longer pre-detects it (would need the regex gate we removed).
  // A light keyword cue keeps the themed loading animation for the obvious cases.
  if (/\bstock picker\b|\bscreener\b|选股|\bscore this stock\b/i.test(query)) {
    return "stockpicker";
  }

  return null;
};
