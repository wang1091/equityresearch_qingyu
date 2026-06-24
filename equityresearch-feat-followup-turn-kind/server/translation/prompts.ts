import type { TargetLanguage } from "./detect";

export const NEWS_SUMMARY_UNAVAILABLE_EN =
  "Summary generation was unavailable for this request. Please refer to the source list below.";
export const NEWS_SUMMARY_UNAVAILABLE_ZH =
  "本次请求未能生成摘要，请参考下方来源列表。";

export function getTranslationInstructions(
  targetLanguage: TargetLanguage,
  mode: "plain" | "markdown" | "html" = "plain",
): string {
  const languageLabel =
    targetLanguage === "zh" ? "natural Simplified Chinese" : "natural English";

  if (mode === "markdown") {
    return `Translate the content into ${languageLabel}. Preserve markdown structure, headings, bullet markers, URLs, ticker symbols, company names, numbers, and formatting. Return markdown only.`;
  }
  if (mode === "html") {
    return `Translate the user-visible content into ${languageLabel}. Preserve all HTML tags, attributes, URLs, ticker symbols, company names, numbers, and formatting. Return HTML only.`;
  }
  return `Translate the content into ${languageLabel}. Preserve ticker symbols, company names, URLs, numbers, and common financial abbreviations. Return text only.`;
}

export function localizeKnownFallbackText(
  text: string | undefined,
  targetLanguage: TargetLanguage,
): string | undefined {
  if (text !== NEWS_SUMMARY_UNAVAILABLE_EN && text !== NEWS_SUMMARY_UNAVAILABLE_ZH) {
    return text;
  }
  return targetLanguage === "zh" ? NEWS_SUMMARY_UNAVAILABLE_ZH : NEWS_SUMMARY_UNAVAILABLE_EN;
}
