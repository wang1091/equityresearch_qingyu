// NEWS simplifier. Lives here (not in a source service module) because NEWS is
// fetched inline in apiCaller's switch and has no service module.
//
// Reads the normalized shape (shared/news NormalizedNewsResponse — apiCaller runs
// normalizeNewsResponse in its parse step). The OLD body looked for
// `content.sections` (which the live response doesn't have — it has
// `content.items`) and rebuilt `items` from `search_results` (= bare domains, not
// headlines), so the LLM got source domains instead of the actual articles. This
// uses the real article items (top-level `items`, else `content.items`) and keeps
// `search_results` only as source links. Curated projection, not a raw dump.

export function simplifyNews(data: any): any {
  if (data && typeof data === "object" && !Array.isArray(data)) {
    const content = data.content && typeof data.content === "object" ? data.content : {};
    const summary =
      typeof content.summary === "string"
        ? content.summary
        : typeof data.summary === "string"
          ? data.summary
          : typeof data.newsContent === "string"
            ? data.newsContent
            : "";

    // Real articles: normalized top-level `items` first, else `content.items`.
    const rawItems = Array.isArray(data.items)
      ? data.items
      : Array.isArray(content.items)
        ? content.items
        : [];
    const items = rawItems.slice(0, 6).map((it: any, i: number) => ({
      rank: typeof it?.rank === "number" ? it.rank : i + 1,
      headline: it?.headline ?? it?.title,
      summary: typeof it?.summary === "string" ? it.summary.slice(0, 280) : undefined,
      date: it?.date,
      publisher: it?.publisher ?? it?.source_label,
      url: it?.source_url ?? it?.url,
    }));

    const notes = Array.isArray(content.notes)
      ? content.notes
      : Array.isArray(data.notes)
        ? data.notes
        : [];

    const sources = (Array.isArray(data.search_results) ? data.search_results : [])
      .slice(0, 5)
      .map((s: any) => ({ publisher: s?.publisher || s?.source, url: s?.url }))
      .filter((s: any) => s.url);

    return {
      ...(typeof content.title === "string" && content.title ? { title: content.title.slice(0, 300) } : {}),
      ...(typeof content.dek === "string" && content.dek ? { dek: content.dek.slice(0, 500) } : {}),
      summary: summary.slice(0, 1800),
      truncated: summary.length > 1800,
      notes: notes.slice(0, 3),
      items,
      ...(sources.length > 0 ? { sources } : {}),
    };
  }

  if (Array.isArray(data)) {
    return data.slice(0, 3).map((item: any) => ({
      title: item.title,
      summary: item.summary?.substring(0, 200),
      published: item.published,
    }));
  }

  return data;
}
