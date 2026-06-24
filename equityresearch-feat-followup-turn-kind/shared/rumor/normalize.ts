// Normalize a raw RUMOR upstream payload into the structured RumorCardData the
// frontend renders. Ports the parsing that used to live inline in
// server/agent/formatters/rumor.ts (parseRumorReport / parseRumorNarrativeReport
// + the markdown/plain field+section extractors) so the card and the source_card
// projector share ONE implementation. Pure string ops — safe in shared/.
import type { RumorCardData } from "./schema";

// ── pure markdown/plain extractors (moved from formatters/_shared.ts) ──
function extractMarkdownField(markdown: string, label: string | string[]): string {
  const labels = Array.isArray(label) ? label : [label];
  for (const item of labels) {
    const esc = item.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const m = markdown.match(new RegExp(`\\*\\*${esc}\\*\\*[:：]\\s*(.+)`, "i"));
    if (m?.[1]?.trim()) return m[1].trim();
  }
  return "";
}

function extractMarkdownSection(markdown: string, section: string | string[]): string {
  const sections = Array.isArray(section) ? section : [section];
  for (const item of sections) {
    const esc = item.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const m = markdown.match(new RegExp(`####\\s+${esc}\\n([\\s\\S]*?)(?=\\n####\\s+|$)`, "i"));
    if (m?.[1]?.trim()) return m[1].trim();
  }
  return "";
}

function extractPlainField(text: string, label: string | string[]): string {
  const labels = Array.isArray(label) ? label : [label];
  for (const item of labels) {
    const esc = item.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const m = text.match(new RegExp(`(?:^|\\n)${esc}:\\s*(.+)`, "i"));
    if (m?.[1]?.trim()) return m[1].trim();
  }
  return "";
}

function extractPlainSection(text: string, section: string, allSections: string[]): string {
  const esc = section.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const next = allSections.map((i) => i.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
  const m = text.match(new RegExp(`(?:^|\\n)${esc}\\n([\\s\\S]*?)(?=\\n(?:${next})\\n|$)`, "i"));
  return m?.[1]?.trim() || "";
}

function stripMarkdownSourcesSection(markdown: string): string {
  return markdown.replace(/\n####\s+(Sources|来源)\n[\s\S]*$/i, "").trim();
}

// ── the two report parsers ──
function parseRumorReport(markdown: string) {
  const normalized = markdown.replace(/\r\n/g, "\n").trim();
  const verdict = extractMarkdownField(normalized, ["Verdict", "结论"]);
  const conclusion = extractMarkdownSection(normalized, ["Conclusion", "结论"]);
  const verdictConfidence =
    verdict.match(/\(Confidence:\s*([^)]+)\)/i)?.[1]?.trim() ||
    verdict.match(/（?置信度[:：]\s*([^)）]+)\)?/i)?.[1]?.trim() ||
    conclusion.match(/Confidence:\s*([A-Za-z]+)/i)?.[1]?.trim() ||
    conclusion.match(/置信度[:：]\s*([^\s，。]+)/i)?.[1]?.trim() ||
    "";
  return {
    rumor: extractMarkdownField(normalized, ["Rumor", "传闻"]),
    verdictLabel: verdict.replace(/\s*(\(|（)\s*(Confidence|置信度)[:：]\s*[^)）]+(\)|）)/i, "").trim(),
    confidence: verdictConfidence,
    summary: extractMarkdownSection(normalized, ["Summary", "摘要"]),
    keyFacts: extractMarkdownSection(normalized, ["Key Facts", "关键事实"])
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => /^[-*]\s+/.test(l))
      .map((l) => l.replace(/^[-*]\s+/, "").trim()),
    analysis: extractMarkdownSection(normalized, ["Analysis", "分析"]),
    conclusion,
    sources: extractMarkdownSection(normalized, ["Sources", "来源"])
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => /^[-*]\s+/.test(l))
      .map((l) => l.replace(/^[-*]\s+/, "").trim()),
  };
}

function parseRumorNarrativeReport(text: string) {
  const normalized = text.replace(/\r\n/g, "\n").trim();
  const sectionNames = ["Summary", "Facts", "Analysis", "Conclusion", "Source link"];
  const conclusion = extractPlainSection(normalized, "Conclusion", sectionNames);
  const verdict = extractPlainField(normalized, "Result");
  const rumorMatch = normalized.match(
    /(?:^|\n)Rumor:\s*\n?([\s\S]*?)(?=\n(?:Result:|Summary\n|Facts\n|Analysis\n|Conclusion\n|Source link\n)|$)/i,
  );
  return {
    title: normalized.split("\n")[0]?.trim() || "",
    rumor: rumorMatch?.[1]?.trim().replace(/^"|"$/g, "") || "",
    verdictLabel: extractPlainField(normalized, "Label") || verdict,
    confidence:
      conclusion.match(/Confidence level:\s*([A-Za-z ]+)/i)?.[1]?.trim() ||
      conclusion.match(/Confidence:\s*([A-Za-z ]+)/i)?.[1]?.trim() ||
      "",
    summary: extractPlainSection(normalized, "Summary", sectionNames),
    keyFacts: extractPlainSection(normalized, "Facts", sectionNames)
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => /^\d+\)\s+/.test(l) || /^[-*]\s+/.test(l))
      .map((l) => l.replace(/^(\d+\)|[-*])\s+/, "").trim()),
    analysis: extractPlainSection(normalized, "Analysis", sectionNames),
    conclusion,
    sources: extractPlainSection(normalized, "Source link", sectionNames)
      .split(";")
      .map((i) => i.trim())
      .filter(Boolean),
  };
}

/**
 * Normalize the raw RUMOR payload into RumorCardData. Mirrors the field-resolution
 * cascade the old formatter used (parsed report → parsed narrative → flat fields).
 */
export function normalizeRumorPayload(data: any, isZh = false): RumorCardData {
  const reportTitle = typeof data?.report?.title === "string" ? data.report.title.trim() : "";
  const reportMarkdown = typeof data?.report?.markdown === "string" ? data.report.markdown.trim() : "";
  const parsed = reportMarkdown ? parseRumorReport(reportMarkdown) : null;
  const fullAnalysis = typeof data?._analysis?.fullAnalysis === "string" ? data._analysis.fullAnalysis.trim() : "";
  const narrative = fullAnalysis ? parseRumorNarrativeReport(fullAnalysis) : null;

  const verdictLabel =
    parsed?.verdictLabel || narrative?.verdictLabel || data?.label || data?.result || data?._analysis?.verdict || data?.detection || "";
  const rumor = parsed?.rumor || narrative?.rumor || data?.rumor || data?.entity || data?.query || "";
  const confidence = parsed?.confidence || narrative?.confidence || data?.confidence || (isZh ? "未知" : "Unknown");
  const summary = parsed?.summary || narrative?.summary || data?.summary || "";
  const facts =
    parsed?.keyFacts?.length ? parsed.keyFacts : narrative?.keyFacts?.length ? narrative.keyFacts : Array.isArray(data?.facts) ? data.facts : [];
  const analysis = parsed?.analysis || narrative?.analysis || data?.analysis || "";
  const conclusion = parsed?.conclusion || narrative?.conclusion || data?.conclusion || "";
  const sources =
    parsed?.sources?.length ? parsed.sources : narrative?.sources?.length ? narrative.sources : Array.isArray(data?.sources) ? data.sources : [];
  const fallbackMarkdown =
    reportMarkdown && !summary && !analysis && !conclusion && facts.length === 0 ? stripMarkdownSourcesSection(reportMarkdown) : "";

  return {
    title: reportTitle || narrative?.title || (isZh ? "谣言核实结果" : "Verification Results"),
    verdictLabel,
    rumor,
    confidence,
    summary,
    facts,
    analysis,
    conclusion,
    sources,
    crossValidation: data?.cross_validation?.agreement || null,
    fallbackMarkdown,
  };
}
