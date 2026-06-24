// Re-exported so consumers can import the chat-payload type from "@/types"
// without dragging in the entire competitive lib.
export type { SuccessResponse as CompetitiveResultData } from "@/lib/competitive/types";

// Message Types
export interface NewsSourceItem {
  title?: string;
  url: string;
  date?: string;
  last_updated?: string;
  snippet?: string;
  publisher?: string;
  provider_source_type?: string;
  provenance?: "search_results" | "citations_backfill";
  source?: string;
}

export interface NewsContentPayload {
  summary: string;
  title?: string;
  dek?: string;
  items?: Array<{
    headline: string;
    summary: string;
    date?: string;
    publisher?: string;
  }>;
  sections?: Array<{
    heading: string;
    paragraphs: string[];
    bullets?: string[];
  }>;
  notes?: string[];
}

export interface NewsV2Data {
  content: NewsContentPayload;
  search_results: NewsSourceItem[];
  citations: string[];
  meta?: Record<string, unknown>;
}

export interface NewsBriefData {
  insights: Array<{
    text: string;
    source?: string;
  }>;
  analyses: Array<{
    text: string;
    source?: string;
  }>;
  responseLanguage?: "en" | "zh";
  ticker?: string;
  companyName?: string;
  currentPrice?: number | null;
  currency?: string;
  date?: string;
  newsItems?: Array<{
    text: string;
    sources?: Array<{
      url: string;
      title?: string;
      publisher?: string;
      date?: string;
      ref?: string;
    }>;
    sourceRefs?: string[];
  }>;
  keySignals?: string[];
  whatMatters?: {
    coreDrivers?: string[];
    whyItMatters?: string;
  };
  expectationGap?: {
    alreadyPricedIn?: string;
    newInformation?: string;
  };
  historicalInsight?: {
    similarCase?: string;
    pattern?: string;
    implication?: string;
  };
  valuationData?: {
    intrinsicValue?: string;
    currentVsTarget?: string;
    verdict?: string;
    confidence?: string;
    recommendation?: string;
    priceTarget?: string;
  };
  valuationImpact?: {
    driver?: string;
    direction?: string;
    duration?: string;
    summary?: string;
  };
  bottomLine?: {
    realityCheck?: string;
    valuationChange?: string;
    watchNext?: string;
  };
  earningsSummary?: {
    quarter?: string;
    sentiment?: string;
    summary?: string;
    highlights?: string[];
    source?: string;
  };
}

export interface TranslationMeta {
  v: number;
  ready: Partial<Record<"en" | "zh", string>>;
}

export interface FollowUp {
  text: string;
  type: "agent_query" | "user_input";
  pillar: "revenue" | "earnings" | "valuation" | "trade_decision" | string;
  move: "deepen" | "contextualize" | "stress_test" | "connect" | "decide" | string;
}

export interface Message {
  id: number;
  content: string;
  sender: "user" | "agent";
  timestamp: Date;
  showIndustrySelector?: boolean;
  contentEn?: string;
  contentZh?: string;
  contentEnHash?: string;
  contentZhHash?: string;
  displayLanguage?: "en" | "zh";
  newsDataEn?: NewsV2Data;
  newsDataZh?: NewsV2Data;
  newsDataEnHash?: string;
  newsDataZhHash?: string;
  briefDataEn?: NewsBriefData;
  briefDataZh?: NewsBriefData;
  briefDataEnHash?: string;
  briefDataZhHash?: string;
  keyInsightsEn?: string[];
  keyInsightsZh?: string[];
  keyInsightsEnHash?: string;
  keyInsightsZhHash?: string;
  suggestedFollowupsEn?: string[];
  suggestedFollowupsZh?: string[];
  suggestedFollowupsEnHash?: string;
  suggestedFollowupsZhHash?: string;
  modules?: string[];
  feedback?: "positive" | "negative";
  keyInsights?: string[];
  suggestedFollowups?: string[];
  structuredFollowups?: FollowUp[];
  intentInfo?: {
    intents: string[];
    tickers: string[];
    reasoning: string;
    confidence: number;
  };
  briefData?: NewsBriefData;
  newsData?: NewsV2Data;
  // Generic structured-card channel: { source, payload }. Rendered by the
  // features/chat/renderers registry keyed on source (RATING / COMPETITIVE / …).
  // Migration target replacing backend HTML cards (docs/CARD_RENDER_MIGRATION_PLAN.md).
  cardData?: { source: string; payload: unknown };
  // Unified-answer sidecar (flag-gated UNIFIED_ANSWER path). The markdown body
  // arrives via `content`; this holds the verdict + verifiable sources/cards.
  unifiedData?: UnifiedAnswerData;
  // Precomputed classifier-history line for an HTML direct card (TRENDING /
  // MARKET_DATA / STOCK_PICKER), from the agent's `history_projection` event.
  // Persisted so a reloaded turn routes on this instead of the card markup.
  classifierText?: string;
  translationMeta?: TranslationMeta;
}

export interface BriefCitation {
  id: string; // "S1" — matches the inline [S1] marker in the body
  n: number; // display number
  label: string; // e.g. "NEWS" / "VALUATION (NVDA)"
  sources: import("@/components/ResearchOutput").BriefSourceRef[];
}

export interface UnifiedAnswerData {
  verdict?: { stance: string; conviction?: string; priceTarget?: string };
  citations?: BriefCitation[];
  source_cards?: Record<string, string>;
  notice?: string;
}

export interface ChatHistoryItem {
  conversationId: string;
  title: string;
  lastUserMessage: string;
  updatedAt: string;
  deletedAt?: string | null;
}

export interface PersistedMessage {
  role: "user" | "assistant";
  content: string;
  timestamp: string;
}

export interface MeResponse {
  userId: string;
  email?: string | null;
}

// Intent Types
export type IntentType = "NEWS" | "EARNINGS" | "VALUATION" | "PERFORMANCE" | "RUMOR" | "COMPETITIVE" | "NEWS_DEFAULT";

// Workflow Types
export interface WorkflowStep {
  id: number;
  title: string;
  desc: string;
}

// API Response Types
export interface NewsResponse {
  error?: string;
  newsContent?: string;
}

export interface ResolveResponse {
  error?: string;
  ticker?: string;
  name?: string;
}

export interface PeersResponse {
  peers?: Array<{
    ticker: string;
    name?: string;
  }>;
}

export interface MetricsResponse {
  [ticker: string]: {
    error?: string;
    [key: string]: any;
  };
}

export interface RumorResponse {
  error?: string;
  _analysis?: {
    fullAnalysis: string;
  };
}

// Module Metadata
export interface ModuleMetadata {
  label: string;
  labelZh: string;
  url: string;
  icon: string;
}

export type ModuleType = "news" | "earnings" | "valuation" | "data" | "fda" | "stockpicker";

export interface ModuleMeta {
  [key: string]: ModuleMetadata;
}

// Industry Type
export type IndustryType = string;
// ============ 数据模型类型 ============

/**
 * 对等公司信息
 */
export interface PeerCompany {
  ticker: string;
  name?: string;
  [key: string]: any;
}

/**
 * FDA 药物信息
 */
export interface Drug {
  drug: string;
  indication?: string;
  status?: string;
  date?: string;
  event?: string;
  eventDetails?: string;
  [key: string]: any;
}

/**
 * FDA 公司信息
 */
export interface FDACompany {
  ticker: string;
  company: string;
  drugs: Drug[];
  latestUpdate?: string;
  [key: string]: any;
}

/**
 * 股票推荐
 */
export interface StockRecommendation {
  symbol: string;
  name: string;
  rationale: string;
  [key: string]: any;
}

/**
 * 财报参与者
 */
export interface EarningsParticipant {
  name: string;
  role: string;
  [key: string]: any;
}

/**
 * 财报段落
 */
export interface TranscriptSegment {
  speaker?: string;
  text: string;
  [key: string]: any;
}

/**
 * 财报段落部分
 */
export interface TranscriptSection {
  title?: string;
  content: string;
  [key: string]: any;
}

/**
 * Q&A 项目
 */
export interface QAItem {
  question?: string;
  answer?: string;
  [key: string]: any;
}

/**
 * 通用 API 响应包装
 */
export interface ApiResponseData<T = any> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
  [key: string]: any;
}

/**
 * 竞争力分析结果
 */
export interface CompetitiveAnalysis {
  company?: string;
  industry?: string;
  forces?: {
    competitive_rivalry?: { score: number; analysis: string };
    threat_of_new_entrants?: { score: number; analysis: string };
    threat_of_substitutes?: { score: number; analysis: string };
    supplier_power?: { score: number; analysis: string };
    buyer_power?: { score: number; analysis: string };
  };
  overall_assessment?: string;
  [key: string]: any;
}

/**
 * 红旗警告
 */
export interface RedFlagData {
  redflag_count?: number;
  severity?: "low" | "medium" | "high";
  summary?: string;
  [key: string]: any;
}
