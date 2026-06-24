import type { NewsV2Data } from "@/types";
import type { UILanguage } from "@/utils/i18n";
import { LOCAL_API_BASE_URL } from "@/utils/constants";

export const translateVisibleContent = async <T,>(
  payload: T,
  targetLanguage: UILanguage,
  mode: "plain" | "html" | "json" = "plain",
): Promise<T> => {
  console.log("[i18n] fetch /api/translate-visible-content", {
    targetLanguage,
    mode,
    payloadType: typeof payload,
    preview: typeof payload === "string" ? payload.slice(0, 80) : Object.keys(payload as any || {}),
  });
  const response = await fetch(`${LOCAL_API_BASE_URL}/api/translate-visible-content`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ payload, targetLanguage, mode }),
  });

  if (!response.ok) {
    console.error("[i18n] translate API non-ok", response.status);
    throw new Error(`Translation failed: ${response.status}`);
  }

  const data = await response.json();
  console.log("[i18n] translate API response", {
    success: data.success,
    hasTranslated: data.data?.translated !== undefined,
    translatedSame: data.data?.translated === payload,
  });
  return (data.data?.translated ?? payload) as T;
};

export const translateNewsDataForLanguage = async (
  payload: NewsV2Data,
  targetLanguage: UILanguage,
): Promise<NewsV2Data> => {
  const content = payload.content || { summary: "" };
  const translated = await translateVisibleContent(
    {
      content: {
        summary: content.summary || "",
        title: content.title || "",
        dek: content.dek || "",
        items: Array.isArray(content.items)
          ? content.items.map((item) => ({
              headline: item.headline || "",
              summary: item.summary || "",
            }))
          : [],
        sections: Array.isArray(content.sections)
          ? content.sections.map((section) => ({
              heading: section.heading || "",
              paragraphs: Array.isArray(section.paragraphs) ? section.paragraphs : [],
              bullets: Array.isArray(section.bullets) ? section.bullets : [],
            }))
          : [],
        notes: Array.isArray(content.notes) ? content.notes : [],
      },
      search_results: Array.isArray(payload.search_results)
        ? payload.search_results.map((source) => ({
            title: source.title || "",
            snippet: source.snippet || "",
          }))
        : [],
    },
    targetLanguage,
    "json",
  );

  return {
    ...payload,
    content: {
      ...content,
      ...translated.content,
    },
    search_results: Array.isArray(payload.search_results)
      ? payload.search_results.map((source, index) => ({
          ...source,
          title: translated.search_results?.[index]?.title || source.title,
          snippet: translated.search_results?.[index]?.snippet || source.snippet,
        }))
      : payload.search_results,
  };
};
