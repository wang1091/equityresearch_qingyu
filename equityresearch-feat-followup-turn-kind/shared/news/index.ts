/**
 * News shared module — wire contract for the normalized NEWS response. Single
 * source of truth (mirrors SmartNews /api/search-news-v2 post-normalization),
 * imported by the server adapter/simplifier and the client news_v2 renderer.
 */
export {
  type NormalizedNewsResponse,
  type NormalizedNewsContent,
  type NormalizedNewsItem,
  type NormalizedNewsSection,
  type NormalizedNewsSource,
  type NormalizedNewsMeta,
} from "./schema";
