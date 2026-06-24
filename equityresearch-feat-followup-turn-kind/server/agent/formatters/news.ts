// server/agent/formatters/news.ts
// Extracted verbatim from cardFormatter.ts (per-source split) — no behavior change.
import { normalizeNewsResponse } from "../newsResponseAdapter";
import {
  buildInlineCitationRefs,
  formatCitationPills,
  pickCitationIndexes,
  formatErrorCard,
} from "./_shared";

// NOTE: currently unreachable via the live SSE path. Single-NEWS intent always
// streams the structured `news_v2` payload (index.ts) when onPayload is wired —
// and the sole chatStream caller (the SSE route) always wires it. This HTML
// fallback only fires for a caller that doesn't wire onPayload (none today).
// Kept intentionally as the no-onPayload fallback; do not assume it's exercised.
export function formatNewsCard(data: any, language: string = "en"): string {
  const isZh = language === "zh";
  const normalized = normalizeNewsResponse(data);
  if (!normalized.summary) {
    return formatErrorCard("NEWS", isZh ? "暂无新闻内容" : "No news content available");
  }

  const cleanedSummary = normalized.summary
    .trim()
    .replace(/\r\n/g, "\n")
    .replace(/\[\d+\]/g, "");

  const splitByBlankLine = cleanedSummary
    .split(/\n\s*\n+/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);

  const splitByLine = cleanedSummary
    .split(/\n+/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);

  const sentenceCandidates = (cleanedSummary.match(/[^.!?。！？]+[.!?。！？]?/g) || [])
    .map((sentence) => sentence.trim())
    .filter(Boolean);

  let summaryParagraphs = splitByBlankLine;
  if (summaryParagraphs.length <= 1) {
    summaryParagraphs = splitByLine;
  }

  // Fallback: when model returns a single long paragraph, split into 3-4 readable blocks.
  if (summaryParagraphs.length <= 1 && sentenceCandidates.length > 1) {
    const targetGroups = sentenceCandidates.length >= 7 ? 4 : 3;
    const chunkSize = Math.ceil(sentenceCandidates.length / targetGroups);
    const groupedParagraphs: string[] = [];

    for (let i = 0; i < sentenceCandidates.length; i += chunkSize) {
      groupedParagraphs.push(
        sentenceCandidates.slice(i, i + chunkSize).join(" ").trim(),
      );
    }

    summaryParagraphs = groupedParagraphs.filter(Boolean);
  }

  if (summaryParagraphs.length === 0) {
    summaryParagraphs = [cleanedSummary];
  }

  const readOnLabel = isZh ? "阅读全文" : "Read on";
  const structuredSections = Array.isArray(normalized.content.sections)
    ? normalized.content.sections
    : [];
  const citationRefs = buildInlineCitationRefs(
    normalized.items
      .map((item) => item.source_url)
      .filter((url): url is string => Boolean(url && url !== "#")),
  );

  const formatParagraph = (paragraph: string, citationIndexes?: number[]): string => {
    return paragraph
      .replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>")
      .replace(
        /(https?:\/\/[^\s<]+)/gi,
        (url: string) =>
          `<a href="${url}" target="_blank" rel="noopener noreferrer" style="color: #2563eb; text-decoration: underline;">${url}</a>`,
      )
      .replace(/\n/g, "<br>") + formatCitationPills(citationRefs, citationIndexes);
  };

  const numberedSummary = structuredSections.length > 0
    ? structuredSections
      .slice(0, 4)
      .map((section, index) => {
        const paragraphBlock = section.paragraphs
          .slice(0, 2)
          .map((paragraph) => `<p style="margin: 0 0 8px 0;">${formatParagraph(paragraph, pickCitationIndexes(citationRefs, index, citationRefs.length > 1 ? 2 : 1))}</p>`)
          .join("");
        const bulletBlock = Array.isArray(section.bullets) && section.bullets.length > 0
          ? `<ul style="margin: 4px 0 0 18px; padding: 0; color: #334155; line-height: 1.6;">
              ${section.bullets.slice(0, 5).map((bullet, bulletIndex) => `<li>${formatParagraph(bullet, pickCitationIndexes(citationRefs, bulletIndex, 1))}</li>`).join("")}
            </ul>`
          : "";

        return `<div style="margin:0 0 12px 0; color:#334155; line-height:1.65;">
          <div style="display:flex; align-items:flex-start; gap:8px; margin-bottom:6px;">
            <span style="font-weight:700; color:#0f172a; min-width:20px;">${index + 1}.</span>
            <span style="flex:1; font-weight:700; color:#111827;">${section.heading}</span>
          </div>
          <div style="margin-left:28px;">${paragraphBlock}${bulletBlock}</div>
        </div>`;
      })
      .join("")
    : summaryParagraphs
      .slice(0, 6)
      .map((paragraph, index) => {
        const formattedParagraph = formatParagraph(
          paragraph,
          pickCitationIndexes(citationRefs, index, citationRefs.length > 1 ? 2 : 1),
        );

        return `<div style="display:flex; align-items:flex-start; gap:8px; margin:0 0 10px 0; color:#334155; line-height:1.65;">
          <span style="font-weight:700; color:#0f172a; min-width:20px;">${index + 1}.</span>
          <span style="flex:1;">${formattedParagraph}</span>
        </div>`;
      })
      .join("");

  const title = normalized.content.title || (isZh ? "最新新闻分析" : "Latest News Analysis");
  let content = `<strong>📰 ${title}</strong><br><br>`;
  if (normalized.content.dek) {
    content += `<div style="margin-bottom: 10px; color: #475569; font-size: 13px; line-height: 1.6;">${formatParagraph(normalized.content.dek)}</div>`;
  }
  content += `<div style="line-height: 1.6;">${numberedSummary}</div>`;

  if (normalized.notes.length > 0) {
    const notesLabel = isZh ? "备注" : "Notes";
    content += `<div style="margin-top: 12px; padding: 10px 12px; background: #f8fafc; border-left: 3px solid #94a3b8; border-radius: 8px;">
      <div style="font-size: 12px; color: #475569; font-weight: 600; margin-bottom: 6px;">📝 ${notesLabel}</div>
      <div style="font-size: 12px; color: #334155; line-height: 1.5;">
        ${normalized.notes.slice(0, 5).map((note) => `• ${note}`).join("<br>")}
      </div>
    </div>`;
  }

  if (normalized.items.length > 0) {
    const sourcesLabel = isZh ? "来源" : "Sources";
    content += `<div style="margin-top: 16px; padding-top: 12px; border-top: 1px solid #e5e7eb;">
      <div style="font-size: 12px; color: #6b7280; margin-bottom: 8px;">📎 ${sourcesLabel}:</div>
      <div style="display: flex; flex-wrap: wrap; gap: 6px;">`;

    normalized.items.slice(0, 5).forEach((item) => {
      const sourceHost = item.source_label || (isZh ? "来源" : "Source");
      const dateText = item.date ? ` (${item.date})` : "";
      const label = `${item.rank}. ${sourceHost}${dateText}`;
      const displayTitle = label.length > 48 ? label.substring(0, 48) + "..." : label;
      const linkUrl = item.source_url || "#";

      content += `<a href="${linkUrl}" target="_blank" rel="noopener noreferrer"
        style="padding: 4px 10px; background: #f3f4f6; color: #4b5563; border-radius: 6px;
               text-decoration: none; font-size: 11px; border: 1px solid #e5e7eb;">
        ${displayTitle}
      </a>`;
    });

    content += `</div></div>`;
  }

  if (normalized.items.length > 0) {
    const listLabel = isZh ? "新闻条目" : "News Items";
    content += `<div style="margin-top: 14px; padding-top: 10px; border-top: 1px dashed #e5e7eb;">
      <div style="font-size: 12px; color: #6b7280; margin-bottom: 6px;">🗂️ ${listLabel}</div>
      <div style="font-size: 12px; line-height: 1.6; color: #334155;">`;

    normalized.items.slice(0, 5).forEach((item) => {
      const safeTitle = item.title.replace(/</g, "&lt;").replace(/>/g, "&gt;");
      const datePart = item.date ? `[${item.date}] ` : "";
      const urlPart = item.source_url
        ? `<a href="${item.source_url}" target="_blank" rel="noopener noreferrer" style="color:#2563eb; text-decoration: underline; margin-left: 6px;">${readOnLabel}</a>`
        : "";
      content += `<div>${item.rank}. ${datePart}${safeTitle}${urlPart}</div>`;
    });

    content += `</div></div>`;
  }

  return content;
}
