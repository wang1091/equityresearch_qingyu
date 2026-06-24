// Aligned with SmartNews /api/search-news-v2 response shape.
// See server/newsSearch/perplexity/types.ts in the SmartNews app for the source schema.

// Contract moved to shared/news (single source of truth). Imported here for the
// adapter's own use and re-exported so existing `import { ... } from
// "./newsResponseAdapter"` call sites keep working unchanged.
import type {
  NormalizedNewsSource,
  NormalizedNewsItem,
  NormalizedNewsSection,
  NormalizedNewsContent,
  NormalizedNewsMeta,
  NormalizedNewsResponse,
} from "../../shared/news";

export type {
  NormalizedNewsSource,
  NormalizedNewsItem,
  NormalizedNewsSection,
  NormalizedNewsContent,
  NormalizedNewsMeta,
  NormalizedNewsResponse,
};

function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function asStringArray(value: unknown, limit = 10): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter((entry): entry is string => typeof entry === "string")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .filter((entry, index, list) => list.indexOf(entry) === index)
    .slice(0, limit);
}

function cleanSummary(raw: string): string {
  return raw
    .replace(/📚\s*Sources:[\s\S]*$/i, "")
    .trim();
}

function normalizeSections(input: unknown): NormalizedNewsSection[] {
  if (!Array.isArray(input)) {
    return [];
  }

  return input
    .map((entry) => {
      if (!entry || typeof entry !== "object") return null;

      const record = entry as Record<string, unknown>;
      const heading = asString(record.heading);
      const paragraphs = asStringArray(record.paragraphs, 5).slice(0, 2);
      const bullets = asStringArray(record.bullets, 8).slice(0, 5);

      if (!heading || (paragraphs.length === 0 && bullets.length === 0)) {
        return null;
      }

      return {
        heading,
        paragraphs,
        ...(bullets.length > 0 ? { bullets } : {}),
      };
    })
    .filter((section): section is NormalizedNewsSection => Boolean(section))
    .slice(0, 4);
}

function normalizeItems(input: unknown): NormalizedNewsItem[] {
  if (!Array.isArray(input)) {
    return [];
  }

  return input
    .map((entry) => {
      if (!entry || typeof entry !== "object") return null;

      const record = entry as Record<string, unknown>;
      const headline = asString(record.headline);
      const summary = asString(record.summary);
      const date = asString(record.date);
      const publisher = asString(record.publisher);

      if (!headline && !summary) return null;

      return {
        headline: headline || summary.slice(0, 80),
        summary,
        ...(date ? { date } : {}),
        ...(publisher ? { publisher } : {}),
      };
    })
    .filter((item): item is NormalizedNewsItem => Boolean(item))
    .slice(0, 10);
}

function normalizeProvenance(value: unknown): "search_results" | "citations_backfill" | undefined {
  return value === "search_results" || value === "citations_backfill" ? value : undefined;
}

function normalizeSourceList(input: unknown): NormalizedNewsSource[] {
  if (!Array.isArray(input)) return [];

  return input
    .map((entry) => {
      if (!entry || typeof entry !== "object") return null;

      const record = entry as Record<string, unknown>;
      const url = asString(record.url);
      if (!url) return null;

      const source: NormalizedNewsSource = { url };
      const title = asString(record.title);
      const date = asString(record.date);
      const lastUpdated = asString(record.last_updated);
      const snippet = asString(record.snippet);
      const publisher = asString(record.publisher);
      const providerSourceType = asString(record.provider_source_type);
      const provenance = normalizeProvenance(record.provenance);
      const sourceLabel = asString(record.source);

      if (title) source.title = title;
      if (date) source.date = date;
      if (lastUpdated) source.last_updated = lastUpdated;
      if (snippet) source.snippet = snippet;
      if (publisher) source.publisher = publisher;
      if (providerSourceType) source.provider_source_type = providerSourceType;
      if (provenance) source.provenance = provenance;
      if (sourceLabel) source.source = sourceLabel;

      return source;
    })
    .filter((entry): entry is NormalizedNewsSource => Boolean(entry));
}

function normalizeCitations(input: unknown): string[] {
  return asStringArray(input).filter((url) => /^https?:\/\//i.test(url));
}

function normalizeMeta(input: unknown): NormalizedNewsMeta | undefined {
  if (!input || typeof input !== "object") return undefined;
  return { ...(input as Record<string, unknown>) };
}

function composeSummaryFromStructured(
  title: string,
  dek: string,
  sections: NormalizedNewsSection[],
  items: NormalizedNewsItem[],
): string {
  const blocks: string[] = [];
  if (title) blocks.push(title);
  if (dek) blocks.push(dek);

  sections.forEach((section) => {
    blocks.push(section.heading);
    if (section.paragraphs.length > 0) blocks.push(section.paragraphs.join("\n\n"));
    if (Array.isArray(section.bullets) && section.bullets.length > 0) {
      blocks.push(section.bullets.map((b) => `- ${b}`).join("\n"));
    }
  });

  items.forEach((item, idx) => {
    const head = `${idx + 1}. ${item.headline}`;
    blocks.push(item.summary ? `${head}\n${item.summary}` : head);
  });

  return cleanSummary(blocks.join("\n\n"));
}

export function normalizeNewsResponse(raw: unknown): NormalizedNewsResponse {
  const record = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};

  const rawContent =
    record.content && typeof record.content === "object"
      ? (record.content as Record<string, unknown>)
      : null;

  const title = rawContent ? asString(rawContent.title) : "";
  const dek = rawContent ? asString(rawContent.dek) : "";
  const sections = rawContent ? normalizeSections(rawContent.sections) : [];
  const items = rawContent ? normalizeItems(rawContent.items) : [];
  const notes = rawContent ? asStringArray(rawContent.notes, 8) : asStringArray(record.notes, 8);

  const summaryFromContent = rawContent ? asString(rawContent.summary) : "";
  const legacySummary =
    asString(record.newsContent) ||
    (typeof record.content === "string" ? asString(record.content) : "") ||
    asString(record.summary);

  const summary = cleanSummary(
    summaryFromContent ||
      legacySummary ||
      composeSummaryFromStructured(title, dek, sections, items),
  );

  const search_results = normalizeSourceList(record.search_results).length > 0
    ? normalizeSourceList(record.search_results)
    : normalizeSourceList(record.sources);
  const citations = normalizeCitations(record.citations);
  const meta = normalizeMeta(record.meta);

  const finalSummary =
    summary ||
    "Summary generation was unavailable for this request. Please refer to the source list below.";

  const enrichedItems = (items.length > 0
    ? items
    : search_results.slice(0, 5).map<NormalizedNewsItem>((source, index) => ({
        headline: source.title || `News Item ${index + 1}`,
        summary: source.snippet || "",
        ...(source.date ? { date: source.date } : {}),
        ...(source.publisher ? { publisher: source.publisher } : {}),
      }))
  ).slice(0, 10).map((item, index) => {
    const matchedSource = search_results[index];
    const sourceUrl = matchedSource?.url || citations[index] || "";
    const sourceLabel =
      item.publisher ||
      matchedSource?.publisher ||
      matchedSource?.source ||
      "";

    return {
      ...item,
      rank: index + 1,
      title: item.headline,
      source_label: sourceLabel,
      source_url: sourceUrl,
      ...(matchedSource?.provenance ? { source_provenance: matchedSource.provenance } : {}),
    };
  });

  const content: NormalizedNewsContent = {
    summary: finalSummary,
    ...(title ? { title } : {}),
    ...(dek ? { dek } : {}),
    ...(items.length > 0 ? { items } : {}),
    ...(sections.length > 0 ? { sections } : {}),
    ...(notes.length > 0 ? { notes } : {}),
  };

  return {
    content,
    search_results,
    citations,
    ...(meta ? { meta } : {}),

    // Legacy aliases.
    summary: finalSummary,
    notes,
    ...(title ? { title } : {}),
    ...(dek ? { dek } : {}),
    ...(sections.length > 0 ? { sections } : {}),
    items: enrichedItems,
    newsContent: finalSummary,
    sources: search_results,
  };
}
