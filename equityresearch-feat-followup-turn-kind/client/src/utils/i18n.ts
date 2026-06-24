// 前端UI语言配置
export type UILanguage = "zh" | "en";

export const DEFAULT_UI_LANGUAGE: UILanguage = "en";
export const UI_LANGUAGE_STORAGE_KEY = "checkit-ui-language";

export const UI_TEXTS = {
  zh: {
    // 欢迎消息（保留原格式）
    welcomeMessage: `<strong>您好！</strong><br>我是您的个人股票研究分析师。试着问我这样的问题：<br>• "苹果公司的最新新闻是什么？"<br>• "特斯拉财报预览"<br>• "微软的合理估值是多少？"<br>• "谣言核实：高通要收购英特尔吗？"<br>• "给我看看 Rivian 2025年Q3财报电话会议摘要"<br>• "哪些股票被低估了？"<br>• "我现在还能买特斯拉股票吗？"<br>• "为什么英特尔股票今天上涨？"`,
    
    // 按钮和输入
    inputPlaceholder: "输入您的问题...",
    send: "发送",
    stop: "停止",
    
    // 导航栏
    navHome: "主页",
    navNewsAnalyst: "智能新闻分析师",
    navRumorCheck: "谣言核实",
    navEarningsAnalyst: "财报会议智能助手",
    navValuationExpert: "估值专家",
    navDataAnalyst: "数据分析师",
    navFDACalendar: "FDA日历",
    navIndustryAnalysis: "行业竞争力分析",
    navStockPicker: "智能选股 (即将上线)",
    navChatHistory: "聊天记录",
    navFunctions: "功能导航",
    appTitle: "小C 投研分析师",
    newThread: "新对话",
    
    // 其他
    loading: "正在处理中...",
    thinking: "思考中...",
    analyzing: "分析中",
    analyzingData: "正在分析市场数据...",
    generatingAnalysis: "正在生成分析...",
    translating: "正在翻译...",
    errorMoreSpecific: "提示：请尝试更具体的问题，如\"特斯拉股价多少？\"",
    usageTip: "使用提示",
    scrollToBottom: "滚动到底部",
    historyLoading: "加载中...",
    historyEmpty: "暂无记录",
    historyDelete: "删除",
    historyLoadFailed: "加载失败",
    
    // AI理解
    aiUnderstanding: "AI 理解",
    intentLabel: "意图:",
    intentDetected: "意图检测",
    
    // 跟进模块
    wantDeeper: "💬 想深入了解？",
    goDeeperWith: "想深入了解？",
    openFromSidebar: "从侧边栏打开 {module} 以探索更多详情。",
    openModule: "打开 {module}",
    open: "打开",
    helpful: "有帮助",
    notHelpful: "没帮助",
    copyResponse: "复制完整回答",
    copy: "复制",
    copyKeyInsights: "仅复制核心洞察",
    copyInsights: "复制洞察",
    refine: "↻ 重新分析",
    followUpTitle: "继续深入",
    followUpAsk: "请告诉我：",
    
    // 语言切换
    switchLanguage: "Switch to English",
    
    // 新闻简报
    newsWantAnalysis: "想要包含可操作见解的综合分析吗？",
    newsGenerateBrief: "生成智能新闻简报",
    newsGeneratingBrief: "📊 正在生成简报 / Generating Brief...",
    newsBriefTitle: "智能新闻简报",
    newsBriefInsights: "可执行洞察",
    newsBriefAnalysis: "分析",
    investmentRiskDisclaimer: "投资有风险，本内容仅供参考",
  },
  en: {
    // Welcome message (original format)
    welcomeMessage: `<strong>Hello!</strong><br>I am your personal equity research analyst. Try asking questions like:<br>• "What's the latest news on Apple?"<br>• "Tesla earnings preview"<br>• "What's Microsoft's fair value?"<br>• "rumor check: Is Qualcomm going to acquire Intel?"<br>• "Show me Q3 2025 earning call summary for Rivian"<br>• "Which stocks are undervalued?"<br>• "Can I still buy Tesla stock now?"<br>• "Why Intel stock jump today?"`,
    
    // Buttons and inputs
    inputPlaceholder: "Type your question...",
    send: "Send",
    stop: "Stop",
    
    // Navigation
    navHome: "Main Page",
    navNewsAnalyst: "News Analyst",
    navRumorCheck: "Rumor Check",
    navEarningsAnalyst: "Earnings Specialist",
    navValuationExpert: "Valuation Expert",
    navDataAnalyst: "Data Analyst",
    navFDACalendar: "FDA Calendar",
    navIndustryAnalysis: "Industry Analysis",
    navStockPicker: "Stock Picker (Coming Soon)",
    navChatHistory: "Chat History",
    navFunctions: "Functions",
    appTitle: "Checkit Equity Research Assistant",
    newThread: "New thread",
    
    // Others
    loading: "Processing...",
    thinking: "Thinking...",
    analyzing: "Analyzing",
    analyzingData: "Analyzing market data...",
    generatingAnalysis: "Generating analysis...",
    translating: "Translating...",
    errorMoreSpecific: "Hint: Try more specific questions like 'What's Tesla's stock price?'",
    usageTip: "Usage Tips",
    scrollToBottom: "Scroll to bottom",
    historyLoading: "Loading...",
    historyEmpty: "No history yet",
    historyDelete: "Delete",
    historyLoadFailed: "Failed to load",
    
    // AI Understanding
    aiUnderstanding: "AI Understanding",
    intentLabel: "Intent:",
    intentDetected: "Intent Detected",
    
    // Follow-up modules
    wantDeeper: "💬 Want to go deeper?",
    goDeeperWith: "Go deeper with",
    openFromSidebar: "Open {module} from the sidebar to explore more details.",
    openModule: "Open {module}",
    open: "Open",
    helpful: "Helpful",
    notHelpful: "Not helpful",
    copyResponse: "Copy response",
    copy: "Copy",
    copyKeyInsights: "Copy key insights",
    copyInsights: "Copy Insights",
    refine: "↻ Refine",
    followUpTitle: "Dig deeper",
    followUpAsk: "Tell me:",
    
    // Language switch
    switchLanguage: "切换到中文",
    
    // News brief
    newsWantAnalysis: "Want a comprehensive analysis with actionable insights?",
    newsGenerateBrief: "Generate Smart News Brief",
    newsGeneratingBrief: "📊 Generating Brief / 正在生成简报...",
    newsBriefTitle: "Smart News Brief",
    newsBriefInsights: "Actionable Insights",
    newsBriefAnalysis: "Analysis",
    investmentRiskDisclaimer: "Investment involves risks. This content is for reference only.",
  },
};

// 获取UI文本
export function getUIText(language: UILanguage, key: keyof typeof UI_TEXTS.zh): string {
  return UI_TEXTS[language][key];
}

export function isUILanguage(value: unknown): value is UILanguage {
  return value === "zh" || value === "en";
}

export function getInitialUILanguage(): UILanguage {
  if (typeof window === "undefined") return DEFAULT_UI_LANGUAGE;

  const storedLanguage = window.localStorage.getItem(UI_LANGUAGE_STORAGE_KEY);
  if (isUILanguage(storedLanguage)) return storedLanguage;

  return window.navigator.language.toLowerCase().startsWith("zh")
    ? "zh"
    : DEFAULT_UI_LANGUAGE;
}
