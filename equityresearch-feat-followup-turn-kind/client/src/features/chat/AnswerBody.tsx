import type { Message } from "@/types";
import { UI_TEXTS, type UILanguage } from "@/utils/i18n";
import { renderMarkdownToHtml, linkCitations } from "@/utils/renderMarkdown";
import { resolveSourceView } from "@/translation/displayUnits";
import {
  SafeHtmlContent,
  InvestmentBrief,
  StructuredJsonFallback,
  isLikelyJsonPayload,
  parseLooseJson,
  tryParseResearchJson,
} from "@/components";

interface AnswerBodyProps {
  message: Message;
  uiLanguage: UILanguage;
  isGenerating: boolean;
}

/**
 * The main answer body for an agent message. resolveSourceView keeps EN/ZH
 * copies in sync for JSON research payloads. Dispatches: research JSON →
 * <InvestmentBrief>, loose JSON → <StructuredJsonFallback>, otherwise markdown
 * (citation-linked when the unified path supplied citations). Returns null when
 * there is nothing to render. Moved verbatim from the home.tsx message map.
 */
export const AnswerBody = ({ message, uiLanguage, isGenerating }: AnswerBodyProps) => {
  const rawContent =
    (resolveSourceView(message).content || "").trim() || message.content?.trim() || "";
  if (!rawContent) return null;

  const researchData = tryParseResearchJson(rawContent);
  if (researchData) return <InvestmentBrief data={researchData} language={uiLanguage} />;

  const looseJson = isLikelyJsonPayload(rawContent) ? parseLooseJson(rawContent) : null;
  if (looseJson !== null) {
    return <StructuredJsonFallback data={looseJson} language={uiLanguage} />;
  }

  const looksLikeJson =
    rawContent.trimStart().startsWith("{") || rawContent.trimStart().startsWith("[");
  if (looksLikeJson && isGenerating) {
    return (
      <div className="flex items-center gap-2 text-xs text-gray-400">
        <div className="loading-spinner w-3.5 h-3.5" />
        <span>{UI_TEXTS[uiLanguage].generatingAnalysis}</span>
      </div>
    );
  }

  const citeIds = message.unifiedData?.citations?.length
    ? new Set(message.unifiedData.citations.map((c) => c.id))
    : null;
  // Single-source citations link inline straight to the article; multi-source /
  // card-backed ones keep jumping to the footer (where they expand into a list).
  const citeUrls = (() => {
    const m = new Map<string, string>();
    for (const c of message.unifiedData?.citations ?? []) {
      const srcs = c.sources ?? [];
      if (srcs.length === 1 && srcs[0].type === "link" && srcs[0].url) {
        m.set(c.id, srcs[0].url);
      }
    }
    return m;
  })();

  const bodyHtml = citeIds
    ? linkCitations(renderMarkdownToHtml(rawContent), citeIds, `cite-${message.id}`, citeUrls)
    : renderMarkdownToHtml(rawContent);

  return (
    <div className="text-sm text-gray-800 leading-relaxed">
      <SafeHtmlContent html={bodyHtml} className="leading-relaxed" />
    </div>
  );
};
