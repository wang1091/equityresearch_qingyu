import type { UILanguage } from "@/utils/i18n";

export interface NavItem {
  label: string;
  icon: string;
  url: string;
  testId: string;
}

/** Sidebar / mobile-drawer / mobile-strip navigation targets, localized. */
export const getNavItems = (uiLanguage: UILanguage): NavItem[] => [
  { label: uiLanguage === "zh" ? "个股分析师"       : "Stock Analyzer",           icon: "💼", url: "https://stockpick.checkitanalytics.com/",     testId: "stock-picker-button" },
  { label: uiLanguage === "zh" ? "智能新闻分析师"   : "Intelligent News Analyst", icon: "📰", url: "https://smartnews.checkitanalytics.com/",    testId: "intelligent-news-analyst-button" },
  { label: uiLanguage === "zh" ? "传闻核实专员"     : "Rumor Check Specialist",   icon: "🔍", url: "https://rumorcheck.checkitanalytics.com/",   testId: "rumor-check-button" },
  { label: uiLanguage === "zh" ? "财报分析师"       : "Earnings Analyst",         icon: "📞", url: "https://smartnews.checkitanalytics.com/rag", testId: "earning-call-specialist-button" },
  { label: uiLanguage === "zh" ? "估值专家"         : "Valuation Expert",         icon: "💰", url: "https://valuation.checkitanalytics.com/",         testId: "valuation-expert-button" },
  { label: uiLanguage === "zh" ? "数据分析师"       : "Data Analyst",             icon: "📊", url: "https://keymetrics.checkitanalytics.com/",         testId: "intelligent-data-analyst-button" },
  { label: uiLanguage === "zh" ? "新药审批日历"     : "FDA Calendar",             icon: "📅", url: "https://fdacalendar.checkitanalytics.com/",  testId: "fda-calendar-button" },
  { label: uiLanguage === "zh" ? "行业竞争力分析"   : "Industry Analysis",        icon: "🏭", url: "/competitive",                                testId: "industry-analysis-button" },
];

/** Example query chips shown on the empty home screen, localized. */
export const getSuggestions = (uiLanguage: UILanguage): string[] =>
  uiLanguage === "zh"
    ? [
        "今日涨幅最大的股票",
        "今日跌幅最大的股票",
        "今天最活跃的股票有哪些？",
        "谷歌今日股价多少钱？",
        "苹果最新新闻",
        "特斯拉财报电话会议摘要",
        "英伟达最近财报电话中分析师提了哪些关键问题？",
        "这个季度Meta挣了多少钱？",
        "高通要收购英特尔吗？",
        "哪些股票被低估了？",
        "英伟达今天为什么上涨？",
        "罗氏有哪些新批准的药物？",
        "分析Joby的竞争优势",
      ]
    : [
        "What are today's top gaining stocks?",
        "What are today's biggest losing stocks?",
        "Most active stocks right now",
        "What's Google's stock price today?",
        "Apple latest news",
        "Tesla earning call summary",
        "Key analyst questions from NVIDIA's most recent earnings call?",
        "How much did Meta make in the quarter?",
        "Is Qualcomm acquiring Intel?",
        "Which stocks are undervalued?",
        "Why did Nvidia jump today?",
        "Any newly approved drugs for Roche?",
        "Analyze Joby's competitive edge",
      ];
