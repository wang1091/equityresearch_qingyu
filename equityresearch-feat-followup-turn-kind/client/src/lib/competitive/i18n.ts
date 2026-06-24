import type { ForceKey, Lang } from "./types";

export type Translation = {
  title: string;
  subtitle: string;
  back: string;
  langSwitch: string;
  analysisTitle: string;
  companyLabel: string;
  companyPlaceholder: string;
  tickerLabel: string;
  tickerPlaceholder: string;
  industryLabel: string;
  industryPlaceholder: string;
  contextLabel: string;
  contextPlaceholder: string;
  analyzeBtn: string;
  analyzing: string;
  overviewTitle: string;
  resultsTitle: string;
  overallAssessment: string;
  forceIntensity: string;
  sourcesTitle: string;
  groundingWarning: string;
  legendCaption: string;
  legendHigh: string;
  legendModerate: string;
  legendLow: string;
  forceLabels: Record<ForceKey, string>;
  forceDescriptions: Record<ForceKey, string>;
};

export const TRANSLATIONS: Record<Lang, Translation> = {
  en: {
    title: "Company Industry Competitive Analysis",
    subtitle: "AI-Powered Competitive Intelligence by Checkit Analytics",
    back: "← Main Page",
    langSwitch: "中文 / EN",
    analysisTitle: "Company Analysis",
    companyLabel: "Target Company",
    companyPlaceholder: "e.g., Tesla, Amazon, Netflix",
    tickerLabel: "Ticker (Optional)",
    tickerPlaceholder: "e.g., TSLA",
    industryLabel: "Industry",
    industryPlaceholder: "e.g., Electric Vehicles, E-commerce",
    contextLabel: "Additional Context (Optional)",
    contextPlaceholder: "Any specific aspects you'd like to focus on...",
    analyzeBtn: "Analyze Business Model",
    analyzing: "Analyzing...",
    overviewTitle: "Framework Overview",
    resultsTitle: "Analysis Results",
    overallAssessment: "Overall Assessment",
    forceIntensity: "Force Intensity",
    sourcesTitle: "Research Sources",
    groundingWarning:
      "⚠️ Generated without real-time web research — verify before relying on this analysis.",
    legendCaption: "Pressure on firm:",
    legendHigh: "High (7–10)",
    legendModerate: "Moderate (4–6)",
    legendLow: "Low / favorable (1–3)",
    forceLabels: {
      competitive_rivalry: "🔄 Competitive Rivalry",
      threat_of_new_entrants: "🚪 Threat of New Entrants",
      threat_of_substitutes: "🔀 Threat of Substitutes",
      supplier_power: "💼 Bargaining Power of Suppliers",
      buyer_power: "🛒 Bargaining Power of Buyers",
    },
    forceDescriptions: {
      competitive_rivalry: "Intensity of competition among existing players",
      threat_of_new_entrants:
        "Ease with which new competitors can enter the market",
      threat_of_substitutes:
        "Likelihood of customers finding alternative products/services",
      supplier_power: "Control suppliers have over pricing and terms",
      buyer_power: "Control customers have over pricing and quality",
    },
  },
  zh: {
    title: "公司行业竞争力分析",
    subtitle: "智能行业分析",
    back: "← 返回主页",
    langSwitch: "中文 / EN",
    analysisTitle: "企业分析",
    companyLabel: "目标公司",
    companyPlaceholder: "例如：特斯拉、亚马逊、奈飞",
    tickerLabel: "股票代码（可选）",
    tickerPlaceholder: "例如：TSLA",
    industryLabel: "行业",
    industryPlaceholder: "例如：电动汽车、无人机、人工智能",
    contextLabel: "补充信息（可选）",
    contextPlaceholder: "您希望重点关注的特定方面...",
    analyzeBtn: "开始分析业务模型",
    analyzing: "分析中...",
    overviewTitle: "框架概述",
    resultsTitle: "分析结果",
    overallAssessment: "总体评估",
    forceIntensity: "力量强度",
    sourcesTitle: "研究来源",
    groundingWarning: "⚠️ 此分析未使用实时网络研究素材，请独立核实后再参考。",
    legendCaption: "公司承受的压力：",
    legendHigh: "高 (7–10)",
    legendModerate: "中等 (4–6)",
    legendLow: "低 / 有利 (1–3)",
    forceLabels: {
      competitive_rivalry: "🔄 现有竞争者之间的竞争",
      threat_of_new_entrants: "🚪 潜在进入者的威胁",
      threat_of_substitutes: "🔀 替代品的威胁",
      supplier_power: "💼 供应商的议价能力",
      buyer_power: "🛒 购买者的议价能力",
    },
    forceDescriptions: {
      competitive_rivalry: "现有参与者之间的竞争激烈程度",
      threat_of_new_entrants: "新竞争者进入市场的难易程度",
      threat_of_substitutes: "客户寻找替代产品或服务的可能性",
      supplier_power: "供应商对价格和条款的控制力",
      buyer_power: "客户对价格和质量的控制力",
    },
  },
};
