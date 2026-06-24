/**
 * Wire contract for the normalized NEWS response (SmartNews /api/search-news-v2,
 * after server/agent/newsResponseAdapter.normalizeNewsResponse). Single source of
 * truth — the adapter, simplifyNews, and the client news_v2 renderer all read
 * this shape. Moved here from newsResponseAdapter.ts (which now re-exports these)
 * so server + client share one definition.
 */

export type NormalizedNewsSource = {
  title?: string;
  url: string;
  date?: string;
  last_updated?: string;
  snippet?: string;
  publisher?: string;
  provider_source_type?: string;
  provenance?: "search_results" | "citations_backfill";
  source?: string;
};

export type NormalizedNewsItem = {
  headline: string;
  summary: string;
  date?: string;
  publisher?: string;
};

export type NormalizedNewsSection = {
  heading: string;
  paragraphs: string[];
  bullets?: string[];
};

export type NormalizedNewsContent = {
  summary: string;
  title?: string;
  dek?: string;
  items?: NormalizedNewsItem[];
  sections?: NormalizedNewsSection[];
  notes?: string[];
};

export type NormalizedNewsMeta = Record<string, unknown> & {
  provider?: string;
  intent?: string;
  sourceMode?: string;
  fallbackApplied?: boolean;
  notice?: string;
};

export type NormalizedNewsResponse = {
  content: NormalizedNewsContent;
  search_results: NormalizedNewsSource[];
  citations: string[];
  meta?: NormalizedNewsMeta;

  // Convenience aliases retained for legacy LLM/HTML paths.
  summary: string;
  notes: string[];
  title?: string;
  dek?: string;
  sections?: NormalizedNewsSection[];
  items: Array<
    NormalizedNewsItem & {
      rank: number;
      title: string;
      source_label: string;
      source_url: string;
      source_provenance?: "search_results" | "citations_backfill";
    }
  >;
  newsContent: string;
  sources: NormalizedNewsSource[];
};
