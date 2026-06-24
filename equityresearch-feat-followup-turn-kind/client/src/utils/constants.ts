// API Configuration
export const LOCAL_API_BASE_URL = "";

function resolveExternalBaseUrl(
  envKey: string,
  productionDefault: string,
  developmentDefault?: string,
): string {
  const configured = (
    import.meta.env[envKey as keyof ImportMetaEnv] as string | undefined
  )?.trim();

  const fallback =
    import.meta.env.DEV && developmentDefault
      ? developmentDefault
      : productionDefault;

  return (configured && configured.length > 0 ? configured : fallback).replace(
    /\/+$/,
    "",
  );
}

export const HOME_PAGE_URL = resolveExternalBaseUrl(
  "VITE_CHECKIT_HOME_URL",
  "https://checkitanalytics.com",
);

export const API_BASE_URL = resolveExternalBaseUrl(
  "VITE_SMARTNEWS_BASE_URL",
  "https://smartnews.checkitanalytics.com",
  "http://127.0.0.1:5000",
);

export const RUMOR_CHECK_API = resolveExternalBaseUrl(
  "VITE_RUMORCHECK_BASE_URL",
  "https://rumorcheck.checkitanalytics.com",
);

export const KEY_METRICS_API = resolveExternalBaseUrl(
  "VITE_KEYMETRICS_BASE_URL",
  "https://keymetrics.checkitanalytics.com",
);

export const VALUATION_API = resolveExternalBaseUrl(
  "VITE_VALUATION_BASE_URL",
  "https://valuation.checkitanalytics.com",
);

export const FD_CALENDAR_API = resolveExternalBaseUrl(
  "VITE_FDA_CALENDAR_BASE_URL",
  "https://fdacalendar.checkitanalytics.com",
);

export const INDUSTRY_ANALYSIS_API = resolveExternalBaseUrl(
  "VITE_INDUSTRY_ANALYSIS_BASE_URL",
  "https://industryanalysis.checkitanalytics.com",
);

export const STOCK_PICKER_API = resolveExternalBaseUrl(
  "VITE_STOCK_PICKER_BASE_URL",
  "https://stockpick.checkitanalytics.com",
);

// Module Metadata
export const MODULE_META = {
  news: {
    label: "Intelligent News Analyst",
    labelZh: "智能新闻分析师",
    url: `${API_BASE_URL}/`,
    icon: "📰",
  },
  rumorcheck: {
    label: "Rumor Check",
    labelZh: "谣言核实",
    url: `${RUMOR_CHECK_API}/`,
    icon: "🔍",
  },
  earnings: {
    label: "Earnings Analyst",
    labelZh: "财报分析师",
    url: `${API_BASE_URL}/rag`,
    icon: "💵",
  },
  valuation: {
    label: "Valuation Expert",
    labelZh: "估值专家",
    url: `${VALUATION_API}/`,
    icon: "💰",
  },
  data: {
    label: "Data Analyst",
    labelZh: "数据分析师",
    url: `${KEY_METRICS_API}/`,
    icon: "📊",
  },
  fda: {
    label: "FDA Calendar",
    labelZh: "FDA日历",
    url: `${FD_CALENDAR_API}/`,
    icon: "📅",
  },
  competitive: {
    label: "Industry Analysis",
    labelZh: "行业竞争力分析",
    // Internal SPA route — used by the chat follow-up "Open" button.
    // The legacy external Flask app is still reachable via
    // INDUSTRY_ANALYSIS_API for back-compat / direct linking.
    url: "/competitive",
    icon: "🏭",
  },
  stockpicker: {
    label: "Stock Picker",
    labelZh: "智能选股",
    url: `${STOCK_PICKER_API}/`,
    icon: "💼",
  },
} as const;
