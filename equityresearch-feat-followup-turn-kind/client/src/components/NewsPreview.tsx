import { useState, type ReactNode } from "react";
import { Newspaper, ExternalLink } from "lucide-react";
import type { NewsContentPayload, NewsSourceItem, NewsV2Data } from "@/types";

type Language = "en" | "zh";

interface NewsPreviewProps {
  data: NewsV2Data;
  language?: Language;
  timestamp?: string;
}

const INLINE_CITATION_PATTERN = /\[\[(\d+)\]\]\((https?:\/\/[^)\s]+)\)/g;

type InlineCitationSource = {
  citationIndex: number;
  url: string;
  domain: string;
  title: string;
  source?: NewsSourceItem;
};

type SourcePanelItem = {
  citationIndex?: number;
  displayTitle: string;
  domain: string;
  metaLine: string;
  snippet?: string;
  url: string;
};

const NEWS_SUMMARY_UNAVAILABLE_EN =
  "Summary generation was unavailable for this request. Please refer to the source list below.";
const NEWS_SUMMARY_UNAVAILABLE_ZH =
  "本次请求未能生成摘要，请参考下方来源列表。";

function localizeNewsFallbackText(text: string, language: Language): string {
  if (text.trim() !== NEWS_SUMMARY_UNAVAILABLE_EN) {
    return text;
  }

  return language === "zh" ? NEWS_SUMMARY_UNAVAILABLE_ZH : NEWS_SUMMARY_UNAVAILABLE_EN;
}

function renderInlineCitations(text: string, validUrls: Set<string>): ReactNode[] {
  const parts: ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  INLINE_CITATION_PATTERN.lastIndex = 0;
  while ((match = INLINE_CITATION_PATTERN.exec(text)) !== null) {
    const [raw, number, url] = match;

    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index));
    }

    const isResolvable = url && (validUrls.size === 0 || validUrls.has(normalizeUrlKey(url)));

    if (isResolvable) {
      parts.push(
        <a
          key={`citation-${url}-${match.index}`}
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="mx-0.5 inline-flex min-w-4 items-center justify-center rounded-full border border-blue-200 bg-blue-50 px-1 text-[10px] font-semibold leading-4 text-blue-700 hover:border-blue-300 hover:bg-blue-100"
          aria-label={`Source ${number}`}
        >
          {number}
        </a>,
      );
    } else {
      parts.push(
        <span
          key={`citation-stub-${match.index}`}
          className="mx-0.5 inline-flex min-w-4 items-center justify-center rounded-full border border-gray-200 bg-gray-50 px-1 text-[10px] font-semibold leading-4 text-gray-500"
        >
          {number}
        </span>,
      );
    }

    lastIndex = match.index + raw.length;
  }

  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex));
  }

  return parts.length > 0 ? parts : [text];
}

function hasInlineCitationMarkup(text: string): boolean {
  INLINE_CITATION_PATTERN.lastIndex = 0;
  return INLINE_CITATION_PATTERN.test(text);
}

function CitationBadge({
  index,
  url,
}: {
  index: number;
  url?: string;
}) {
  if (!url) return null;

  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="mx-0.5 inline-flex min-w-4 items-center justify-center rounded-full border border-blue-200 bg-blue-50 px-1 text-[10px] font-semibold leading-4 text-blue-700 hover:border-blue-300 hover:bg-blue-100"
      aria-label={`Source ${index}`}
    >
      {index}
    </a>
  );
}

function normalizeUrlKey(url: string): string {
  if (!url) return "";

  try {
    const parsed = new URL(url.trim());
    const normalizedPath = parsed.pathname.replace(/\/+$/, "");
    return `${parsed.hostname.toLowerCase()}${normalizedPath}`;
  } catch {
    return url.trim().toLowerCase().replace(/[.,;)\]]+$/, "");
  }
}

function extractDomainFromUrl(url?: string): string {
  if (!url) return "";

  try {
    const parsed = new URL(url.trim());
    return parsed.hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

function isLikelyPlaceholderTitle(title: string, publisher?: string, domain?: string): boolean {
  const normalizedTitle = title.trim().toLowerCase();
  const normalizedPublisher = (publisher || "").trim().toLowerCase();
  const normalizedDomain = (domain || "").trim().toLowerCase();

  if (!normalizedTitle || /^\d+$/.test(normalizedTitle)) return true;

  return [normalizedPublisher, normalizedDomain, "web", "source", "citation_backfill"]
    .filter(Boolean)
    .includes(normalizedTitle);
}

function cleanProviderTitle(title?: string, publisher?: string, domain?: string): string {
  const normalizedTitle = title?.trim() || "";
  return normalizedTitle && !isLikelyPlaceholderTitle(normalizedTitle, publisher, domain)
    ? normalizedTitle
    : "";
}

function isLowQualitySlugSegment(segment: string): boolean {
  const normalized = segment.trim().toLowerCase().replace(/\.(html?|aspx?|php)$/i, "");

  if (
    !normalized ||
    /^(index|home|news|article|articles|story|stories|content|press|release|releases)$/.test(normalized) ||
    /^\d+$/.test(normalized) ||
    /^(19|20)\d{2}$/.test(normalized) ||
    /^(0?[1-9]|1[0-2])$/.test(normalized) ||
    /^(0?[1-9]|[12]\d|3[01])$/.test(normalized)
  ) {
    return true;
  }

  if (/^[a-f0-9]{12,}$/i.test(normalized) || /^[a-f0-9-]{24,}$/i.test(normalized)) return true;

  return !/[a-z]/i.test(normalized) || normalized.length < 8;
}

function toTitleCaseFromSlug(slug: string): string {
  const smallWords = new Set(["a", "an", "and", "as", "at", "by", "for", "from", "in", "of", "on", "or", "the", "to", "vs", "with"]);
  const words = slug
    .replace(/\.(html?|aspx?|php)$/i, "")
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ");

  return words.map((word, index) => {
    const lower = word.toLowerCase();
    if (index > 0 && smallWords.has(lower)) return lower;
    return lower.charAt(0).toUpperCase() + lower.slice(1);
  }).join(" ");
}

function buildTitleFromUrlSlug(url?: string): string {
  if (!url) return "";

  try {
    const parsed = new URL(url.trim());
    const segments = parsed.pathname
      .split("/")
      .map((segment) => {
        try {
          return decodeURIComponent(segment);
        } catch {
          return segment;
        }
      })
      .filter((segment) => !isLowQualitySlugSegment(segment));
    const bestSegment = segments.sort((left, right) => right.length - left.length)[0];

    return bestSegment ? toTitleCaseFromSlug(bestSegment) : "";
  } catch {
    return "";
  }
}

function buildSourceDisplayTitle(params: {
  providerTitle?: string;
  url?: string;
  publisher?: string;
  domain?: string;
  index: number;
  language: Language;
}): string {
  const providerTitle = cleanProviderTitle(params.providerTitle, params.publisher, params.domain);
  const slugTitle = buildTitleFromUrlSlug(params.url);
  const publisher = params.publisher?.trim() || "";
  const domain = params.domain?.trim() || "";

  return providerTitle
    || slugTitle
    || publisher
    || domain
    || (params.language === "en" ? `Source ${params.index + 1}` : `来源 ${params.index + 1}`);
}

function getSourceTierLabel(domain: string, publisher?: string): string {
  const normalized = `${domain} ${publisher || ""}`.toLowerCase();

  if (
    normalized.includes("investor.") ||
    normalized.includes("/investor") ||
    normalized.includes("newsroom") ||
    normalized.includes("apple.com") ||
    normalized.includes("microsoft.com") ||
    normalized.includes("nvidia.com") ||
    normalized.includes("snowflake.com")
  ) {
    return "Official Source";
  }

  if (
    normalized.includes("reuters.com") ||
    normalized.includes("bloomberg.com") ||
    normalized.includes("cnbc.com") ||
    normalized.includes("wsj.com") ||
    normalized.includes("ft.com")
  ) {
    return "Trusted Media";
  }

  if (
    normalized.includes("finance.yahoo.com") ||
    normalized.includes("marketwatch.com") ||
    normalized.includes("nasdaq.com")
  ) {
    return "Market Coverage";
  }

  if (
    normalized.includes("macrumors.com") ||
    normalized.includes("macworld.com") ||
    normalized.includes("theverge.com")
  ) {
    return "Industry Media";
  }

  return publisher || "Source";
}

function buildStructuredCitationTextValues(content: NewsContentPayload): string[] {
  const values: string[] = [];
  if (content.title) values.push(content.title);
  if (content.dek) values.push(content.dek);
  if (content.summary) values.push(content.summary);
  (content.notes || []).forEach((note) => values.push(note));

  (content.sections || []).forEach((section) => {
    values.push(section.heading);
    values.push(...section.paragraphs);
    if (Array.isArray(section.bullets)) values.push(...section.bullets);
  });

  (content.items || []).forEach((item) => {
    values.push(item.headline);
    if (item.summary) values.push(item.summary);
    if (item.date) values.push(item.date);
    if (item.publisher) values.push(item.publisher);
  });

  return values;
}

function extractInlineCitationSources(
  values: string[],
  sources: NewsSourceItem[],
  language: Language,
): InlineCitationSource[] {
  const sourceByUrl = new Map(
    sources
      .filter((entry) => entry?.url)
      .map((entry) => [normalizeUrlKey(entry.url), entry] as const),
  );
  const citationByKey = new Map<string, InlineCitationSource>();

  for (const value of values) {
    if (!value) continue;

    INLINE_CITATION_PATTERN.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = INLINE_CITATION_PATTERN.exec(value)) !== null) {
      const citationIndex = Number.parseInt(match[1] || "", 10);
      const url = match[2] || "";
      const urlKey = normalizeUrlKey(url);
      if (!Number.isFinite(citationIndex) || !urlKey || citationByKey.has(urlKey)) continue;

      const source = sourceByUrl.get(urlKey);
      const domain = extractDomainFromUrl(url);
      citationByKey.set(urlKey, {
        citationIndex,
        url,
        domain,
        title: buildSourceDisplayTitle({
          providerTitle: source?.title,
          url,
          publisher: source?.publisher,
          domain,
          index: citationIndex - 1,
          language,
        }),
        source,
      });
    }
  }

  return Array.from(citationByKey.values()).sort(
    (left, right) => left.citationIndex - right.citationIndex,
  );
}

export function NewsPreview({ data, language = "en", timestamp }: NewsPreviewProps) {
  const [isFallbackSummaryExpanded, setIsFallbackSummaryExpanded] = useState(false);
  const [isSourcesExpanded, setIsSourcesExpanded] = useState(false);

  const content = data.content || { summary: "" };
  const sources = Array.isArray(data.search_results) ? data.search_results : [];

  const validUrlKeys = new Set(
    sources.filter((s) => s?.url).map((s) => normalizeUrlKey(s.url)),
  );

  const items = Array.isArray(content.items)
    ? content.items
        .map((item) => {
          const headline = item?.headline?.trim() || "";
          const summary = item?.summary?.trim() || "";
          const date = item?.date?.trim() || "";
          const publisher = item?.publisher?.trim() || "";
          if (!headline && !summary) return null;
          return {
            headline: headline || (language === "en" ? "News item" : "新闻条目"),
            summary,
            ...(date ? { date } : {}),
            ...(publisher ? { publisher } : {}),
          };
        })
        .filter((item): item is { headline: string; summary: string; date?: string; publisher?: string } => Boolean(item))
        .slice(0, 5)
    : [];

  const sections = Array.isArray(content.sections)
    ? content.sections
        .map((section) => {
          const heading = section?.heading?.trim() || "";
          const paragraphs = Array.isArray(section?.paragraphs)
            ? section.paragraphs.map((p) => (typeof p === "string" ? p.trim() : "")).filter(Boolean).slice(0, 2)
            : [];
          const bullets = Array.isArray(section?.bullets)
            ? section.bullets.map((b) => (typeof b === "string" ? b.trim() : "")).filter(Boolean).slice(0, 5)
            : [];
          if (!heading || (paragraphs.length === 0 && bullets.length === 0)) return null;
          return { heading, paragraphs, ...(bullets.length > 0 ? { bullets } : {}) };
        })
        .filter((section): section is { heading: string; paragraphs: string[]; bullets?: string[] } => Boolean(section))
        .slice(0, 4)
    : [];

  const summaryText = localizeNewsFallbackText(content.summary?.trim() || "", language);

  const hasItems = items.length > 0;
  const hasSections = sections.length > 0;
  const hasStructuredContent = Boolean(content.title?.trim() || content.dek?.trim() || hasItems || hasSections || summaryText);

  const inlineCitationSources = extractInlineCitationSources(
    buildStructuredCitationTextValues(content),
    sources,
    language,
  );
  const hasInlineCitationSources = inlineCitationSources.length > 0;

  const renderText = (text: string) => renderInlineCitations(text, validUrlKeys);
  const renderCitationForSourceIndex = (sourceIndex: number, text = "") => {
    if (hasInlineCitationSources || hasInlineCitationMarkup(text)) return null;
    const source = sources[sourceIndex];
    return <CitationBadge index={sourceIndex + 1} url={source?.url} />;
  };
  const renderCitationRange = (startIndex: number, count = 2, text = "") => {
    if (hasInlineCitationSources || hasInlineCitationMarkup(text)) return null;

    return sources
      .slice(startIndex, startIndex + count)
      .map((source, offset) => (
        <CitationBadge
          key={`${source.url}-${startIndex + offset}`}
          index={startIndex + offset + 1}
          url={source.url}
        />
      ));
  };

  const inlineSourcePanelItems: SourcePanelItem[] = inlineCitationSources.map((entry) => {
    const date = entry.source?.date || entry.source?.last_updated || "";
    const tier = getSourceTierLabel(entry.domain, entry.source?.publisher || entry.source?.source);
    return {
      citationIndex: entry.citationIndex,
      displayTitle: entry.title,
      domain: entry.domain,
      metaLine: [entry.domain, tier, date].filter(Boolean).join(" · "),
      snippet: entry.source?.snippet || "",
      url: entry.url,
    };
  });

  const fallbackSourcePanelItems: SourcePanelItem[] = sources
    .filter((entry) => entry?.url)
    .map((entry, index) => {
      const domain = extractDomainFromUrl(entry.url);
      const tier = getSourceTierLabel(domain, entry.publisher || entry.source);
      const date = entry.date || entry.last_updated || "";
      return {
        displayTitle: buildSourceDisplayTitle({
          providerTitle: entry.title,
          url: entry.url,
          publisher: entry.publisher,
          domain,
          index,
          language,
        }),
        domain,
        metaLine: [domain, tier, date].filter(Boolean).join(" · "),
        snippet: entry.snippet || "",
        url: entry.url,
      };
    });

  const sourcePanelItems = hasInlineCitationSources ? inlineSourcePanelItems : fallbackSourcePanelItems;
  const visibleSourceLimit = 3;
  const visibleSourcePanelItems = isSourcesExpanded
    ? sourcePanelItems
    : sourcePanelItems.slice(0, visibleSourceLimit);

  const fallbackSummaryBody = summaryText || (language === "en" ? "No AI summary content available." : "暂无AI摘要内容。");
  const shouldShowFallbackSummaryToggle = fallbackSummaryBody.length > 180;

  const renderSourcesPanel = () => {
    if (sourcePanelItems.length === 0) {
      return (
        <div className="rounded-lg border border-dashed border-gray-300 p-3 space-y-2">
          <p className="text-xs sm:text-sm text-gray-600">
            {language === "en"
              ? "No grounded source articles were returned for this answer."
              : "该回答未返回可溯源的检索文章。"}
          </p>
        </div>
      );
    }

    const totalReferenceCount = hasInlineCitationSources
      ? inlineCitationSources.length
      : sourcePanelItems.length;
    const displayedCount = isSourcesExpanded
      ? sourcePanelItems.length
      : Math.min(sourcePanelItems.length, visibleSourceLimit);

    return (
      <div className="rounded-lg border border-gray-200 bg-white">
        <div className="flex flex-col gap-1 border-b border-gray-200 px-3 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-4">
          <div>
            <h4 className="text-sm sm:text-base font-semibold text-gray-900">
              {language === "en"
                ? `Top Sources ${displayedCount} of ${totalReferenceCount}`
                : `优先来源 ${displayedCount}/${totalReferenceCount}`}
            </h4>
            <p className="text-xs text-gray-500">
              {language === "en"
                ? hasInlineCitationSources
                  ? "Citation numbers in the summary are clickable; these rows are compact source highlights."
                  : "Retrieved articles supporting this summary."
                : hasInlineCitationSources
                  ? "摘要中的引用编号可点击；这里是紧凑的重点来源列表。"
                  : "用于支撑该摘要的检索文章。"}
            </p>
          </div>
          {sourcePanelItems.length > visibleSourceLimit && (
            <button
              type="button"
              onClick={() => setIsSourcesExpanded((prev) => !prev)}
              className="self-start text-xs sm:text-sm text-blue-600 hover:text-blue-800 sm:self-center"
            >
              {isSourcesExpanded
                ? (language === "en" ? "Show less" : "收起")
                : (language === "en"
                    ? `View all ${sourcePanelItems.length} sources`
                    : `查看全部 ${sourcePanelItems.length} 个来源`)}
            </button>
          )}
        </div>

        <div className="divide-y divide-gray-100">
          {visibleSourcePanelItems.map((entry, index) => (
            <div
              key={`${entry.url}-${index}`}
              className="grid gap-2 px-3 py-2.5 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center sm:px-4"
            >
              <div className="min-w-0 space-y-0.5">
                <p className="truncate text-xs sm:text-sm font-medium text-gray-900">
                  {entry.citationIndex ? `[${entry.citationIndex}] ` : ""}
                  {entry.displayTitle}
                </p>
                <p className="truncate text-[11px] sm:text-xs text-gray-500">
                  {entry.metaLine || entry.domain}
                </p>
              </div>
              {entry.url ? (
                <a
                  href={entry.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-[11px] sm:text-xs text-blue-600 hover:text-blue-800"
                >
                  <ExternalLink className="h-3 w-3" />
                  <span>{language === "en" ? "Open" : "打开"}</span>
                </a>
              ) : (
                <span className="text-[11px] sm:text-xs text-gray-400">
                  {language === "en" ? "Unavailable" : "不可用"}
                </span>
              )}
            </div>
          ))}
        </div>
      </div>
    );
  };

  return (
    <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-2 sm:p-4 md:p-6">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between mb-3 sm:mb-4">
        <div className="flex items-center gap-2">
          <Newspaper className="w-4 h-4 sm:w-5 sm:h-5 text-gray-600 flex-shrink-0" />
          <h3 className="text-base sm:text-lg font-semibold text-gray-900 break-words">
            {language === "en" ? "The Latest News" : "最新新闻"}
          </h3>
        </div>
        {timestamp && (
          <p className="text-xs sm:text-sm text-gray-500 break-words">
            {language === "en" ? "Updated:" : "更新时间:"} {timestamp}
          </p>
        )}
      </div>

      {!hasStructuredContent ? (
        <div className="space-y-4">
          <div className="rounded-lg border border-blue-200 bg-blue-50/70 p-4 sm:p-5 space-y-3">
            <h4 className="text-sm sm:text-base font-semibold text-blue-900">
              {language === "en" ? "AI Summary" : "AI摘要"}
            </h4>
            <p
              className="text-sm sm:text-base text-gray-700 whitespace-pre-line leading-relaxed"
              style={!isFallbackSummaryExpanded ? {
                display: "-webkit-box",
                WebkitLineClamp: 3,
                WebkitBoxOrient: "vertical",
                overflow: "hidden",
              } : undefined}
            >
              {renderText(fallbackSummaryBody)}
            </p>
            {shouldShowFallbackSummaryToggle && (
              <button
                type="button"
                onClick={() => setIsFallbackSummaryExpanded((prev) => !prev)}
                className="text-xs sm:text-sm text-blue-600 hover:text-blue-800"
              >
                {isFallbackSummaryExpanded
                  ? (language === "en" ? "Show less" : "收起")
                  : (language === "en" ? "Show more" : "展开更多")}
              </button>
            )}
          </div>

          {renderSourcesPanel()}
        </div>
      ) : (
        <div className="space-y-6">
          <div className="bg-gray-50 rounded-lg border border-gray-200 p-4 sm:p-5 space-y-4">
            <h4 className="text-md font-semibold text-gray-800">
              {renderText(content.title?.trim() || (language === "en" ? "Summary" : "摘要"))}
              {renderCitationRange(0, 1, content.title?.trim() || "")}
            </h4>

            {content.dek?.trim() && (
              <p className="text-sm sm:text-base text-gray-700 leading-relaxed whitespace-pre-line">
                {renderText(content.dek.trim())}
                {renderCitationRange(0, 2, content.dek.trim())}
              </p>
            )}

            {hasItems ? (
              <ol className="space-y-4">
                {items.map((item, idx) => (
                  <li key={`${item.headline}-${idx}`} className="space-y-1.5">
                    <div className="flex flex-col gap-1 sm:flex-row sm:items-baseline sm:gap-2">
                      <h5 className="text-sm sm:text-base font-semibold text-gray-800">
                        {idx + 1}. {renderText(item.headline)}
                        {renderCitationForSourceIndex(idx, item.headline)}
                      </h5>
                      {(item.date || item.publisher) && (
                        <p className="text-[11px] sm:text-xs text-gray-500">
                          {[item.date, item.publisher].filter(Boolean).join(" · ")}
                        </p>
                      )}
                    </div>
                    {item.summary && (
                      <p className="text-sm sm:text-base text-gray-700 leading-relaxed whitespace-pre-line">
                        {renderText(item.summary)}
                        {renderCitationForSourceIndex(idx, item.summary)}
                      </p>
                    )}
                  </li>
                ))}
              </ol>
            ) : hasSections ? (
              <div className="space-y-4">
                {sections.map((section, idx) => (
                  <section key={`${section.heading}-${idx}`} className="space-y-2">
                    <h5 className="text-sm sm:text-base font-semibold text-gray-800">
                      {idx + 1}. {renderText(section.heading)}
                      {renderCitationForSourceIndex(idx, section.heading)}
                    </h5>
                    {section.paragraphs.length > 0 && (
                      <div className="space-y-2 text-sm sm:text-base text-gray-700 leading-relaxed">
                        {section.paragraphs.map((paragraph, paragraphIndex) => (
                          <p key={`${section.heading}-paragraph-${paragraphIndex}`} className="whitespace-pre-line">
                            {renderText(paragraph)}
                            {renderCitationRange(idx, 2, paragraph)}
                          </p>
                        ))}
                      </div>
                    )}
                    {Array.isArray(section.bullets) && section.bullets.length > 0 && (
                      <ul className="list-disc list-inside space-y-1 text-sm sm:text-base text-gray-700 leading-relaxed">
                        {section.bullets.map((bullet, bulletIndex) => (
                          <li key={`${section.heading}-bullet-${bulletIndex}`} className="whitespace-pre-line">
                            {renderText(bullet)}
                            {renderCitationForSourceIndex(bulletIndex, bullet)}
                          </li>
                        ))}
                      </ul>
                    )}
                  </section>
                ))}
              </div>
            ) : summaryText ? (
              <p className="text-sm sm:text-base text-gray-700 leading-relaxed whitespace-pre-line">
                {renderText(summaryText)}
                {renderCitationRange(0, 3, summaryText)}
              </p>
            ) : null}
          </div>

          {renderSourcesPanel()}

          {Array.isArray(content.notes) && content.notes.length > 0 && (
            <div className="bg-white rounded-lg border border-gray-200 p-4">
              <h4 className="text-md font-semibold text-gray-800 mb-3">
                {language === "en" ? "Notes" : "备注"}
              </h4>
              <div className="space-y-2 text-sm text-gray-700">
                {content.notes.slice(0, 5).map((note, idx) => (
                  <p key={`${note}-${idx}`} className="whitespace-pre-line">- {renderText(note)}</p>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default NewsPreview;
