import type { Message } from "@/types";
import type { UILanguage } from "@/utils/i18n";

/**
 * Copy a message's content to the clipboard. With `keyInsightsOnly`, pulls the
 * `key_insights` array out of a structured JSON answer; otherwise strips HTML to
 * plain text while preserving paragraph breaks. Moved verbatim from home.tsx.
 */
export const copyContent = (content: string, keyInsightsOnly = false): void => {
  let text = content;
  if (keyInsightsOnly) {
    try {
      const parsed = JSON.parse(content);
      const insights: string[] = parsed.key_insights || [];
      text = insights.join("\n");
    } catch { /* use full content */ }
  } else {
    // Strip HTML for plain text copy, but preserve paragraph breaks
    text = content
      .replace(/<[^>]+>/g, "")
      .replace(/[ \t]+/g, " ")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }
  void navigator.clipboard.writeText(text);
};

/**
 * Flatten a message into copyable plain text. Prefers raw `content`, then a
 * news-brief, then a structured news payload (title/dek/summary/items/sections/
 * notes + source URLs). `uiLanguage` only labels the sources block.
 */
export const getMessageCopyContent = (message: Message, uiLanguage: UILanguage): string => {
  if (message.content) return message.content;
  if (message.briefData) {
    const brief = message.briefData;
    const lines: string[] = [];
    if (brief.ticker) lines.push(brief.ticker + (brief.companyName ? ` (${brief.companyName})` : ""));
    brief.insights?.forEach((item) => { if (item?.text?.trim()) lines.push(item.text.trim()); });
    brief.analyses?.forEach((item) => { if (item?.text?.trim()) lines.push(item.text.trim()); });
    return lines.join("\n\n");
  }
  if (!message.newsData) return "";

  const { content, search_results: sources } = message.newsData;
  const lines: string[] = [];

  if (content.title?.trim()) lines.push(content.title.trim());
  if (content.dek?.trim()) lines.push(content.dek.trim());
  if (content.summary?.trim()) lines.push(content.summary.trim());

  content.items?.forEach((item, index) => {
    const headline = item.headline?.trim();
    const summary = item.summary?.trim();
    if (headline) lines.push(`${index + 1}. ${headline}`);
    if (summary) lines.push(summary);
  });

  content.sections?.forEach((section) => {
    if (section.heading?.trim()) lines.push(section.heading.trim());
    section.paragraphs?.forEach((paragraph) => {
      if (paragraph?.trim()) lines.push(paragraph.trim());
    });
    section.bullets?.forEach((bullet) => {
      if (bullet?.trim()) lines.push(`- ${bullet.trim()}`);
    });
  });

  content.notes?.forEach((note) => {
    if (note?.trim()) lines.push(note.trim());
  });

  const sourceUrls = sources?.map((source) => source.url).filter(Boolean) || [];
  if (sourceUrls.length > 0) {
    lines.push(uiLanguage === "zh" ? "来源:" : "Sources:");
    sourceUrls.forEach((url) => lines.push(url));
  }

  return lines.join("\n\n");
};
