// server/agent/formatters/rumor.ts
// Extracted verbatim from cardFormatter.ts (per-source split) — no behavior change.
import {
  escapeHtml,
  buildInlineCitationRefs,
  formatCitationPills,
  pickCitationIndexes,
  extractMarkdownField,
  extractMarkdownSection,
  extractPlainField,
  extractPlainSection,
  formatParagraphs,
  formatInlineText,
  stripMarkdownSourcesSection,
} from "./_shared";

export function formatRumorCard(data: any, language: string = "en"): string {
  const isZh = language === "zh";
  const reportTitle =
    typeof data.report?.title === "string" ? data.report.title.trim() : "";
  const reportMarkdown =
    typeof data.report?.markdown === "string" ? data.report.markdown.trim() : "";
  const parsedReport = reportMarkdown ? parseRumorReport(reportMarkdown) : null;
  const fullAnalysis =
    typeof data._analysis?.fullAnalysis === "string"
      ? data._analysis.fullAnalysis.trim()
      : "";
  const parsedNarrativeReport = fullAnalysis
    ? parseRumorNarrativeReport(fullAnalysis)
    : null;

  // Support both the older flat detect-rumor payload and the
  // newer chatbot payload with `report.title` / `report.markdown`.
  const verdictLabel =
    parsedReport?.verdictLabel ||
    parsedNarrativeReport?.verdictLabel ||
    data.label ||
    data.result ||
    data._analysis?.verdict ||
    data.detection ||
    "";
  const rumorText =
    parsedReport?.rumor ||
    parsedNarrativeReport?.rumor ||
    data.rumor ||
    data.entity ||
    data.query ||
    "";
  const confidence =
    parsedReport?.confidence ||
    parsedNarrativeReport?.confidence ||
    data.confidence ||
    (isZh ? "未知" : "Unknown");
  const summary =
    parsedReport?.summary ||
    parsedNarrativeReport?.summary ||
    data.summary ||
    "";
  const facts: string[] =
    (parsedReport?.keyFacts && parsedReport.keyFacts.length > 0)
      ? parsedReport.keyFacts
      : (parsedNarrativeReport?.keyFacts && parsedNarrativeReport.keyFacts.length > 0)
        ? parsedNarrativeReport.keyFacts
      : Array.isArray(data.facts)
        ? data.facts
        : [];
  const analysis =
    parsedReport?.analysis ||
    parsedNarrativeReport?.analysis ||
    data.analysis ||
    "";
  const conclusion =
    parsedReport?.conclusion ||
    parsedNarrativeReport?.conclusion ||
    data.conclusion ||
    "";
  const sources: string[] =
    (parsedReport?.sources && parsedReport.sources.length > 0)
      ? parsedReport.sources
      : (parsedNarrativeReport?.sources && parsedNarrativeReport.sources.length > 0)
        ? parsedNarrativeReport.sources
      : Array.isArray(data.sources)
        ? data.sources
        : [];
  const crossValidation = data.cross_validation || null;
  const fallbackMarkdown =
    reportMarkdown && !summary && !analysis && !conclusion && facts.length === 0
      ? stripMarkdownSourcesSection(reportMarkdown)
      : "";
  const citationRefs = buildInlineCitationRefs(sources);

  if (!verdictLabel && !summary && !analysis && !fallbackMarkdown) {
    return `<div style="padding: 16px; background: #fffbeb; border-left: 4px solid #f59e0b; border-radius: 8px;">
      <strong>🔍 ${isZh ? "谣言核实" : "Rumor Check"}</strong><br><br>
      <div style="color: #92400e;">${isZh ? "未能获取完整的核实报告。" : "Unable to retrieve full verification report."}</div>
    </div>`;
  }

  const factItems = facts
    .map(
      (fact, index) =>
        `<li style="margin-bottom:6px; color:#374151; line-height:1.7;">${escapeHtml(fact)}${formatCitationPills(citationRefs, pickCitationIndexes(citationRefs, index, 1))}</li>`,
    )
    .join("");

  const sourceLinks = citationRefs
    .map((ref) => {
      const safeUrl = escapeHtml(ref.url);
      return `<li style="margin-bottom:6px;"><a href="${safeUrl}" target="_blank" rel="noopener noreferrer" style="color:#2563eb; text-decoration:underline; overflow-wrap:anywhere;">[${ref.index}] ${safeUrl}</a></li>`;
    })
    .join("");
  const primaryCitation = formatCitationPills(citationRefs, pickCitationIndexes(citationRefs, 0, 1));
  const summaryCitations = pickCitationIndexes(citationRefs, 0, citationRefs.length > 1 ? 2 : 1);
  const analysisCitations = pickCitationIndexes(citationRefs, 1, citationRefs.length > 1 ? 2 : 1);

  return `<div style="font-family:-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; color:#1f2937;">
    <h3 style="font-size:1.35em; font-weight:700; color:#111827; margin:0 0 14px;">
      ${escapeHtml(
        reportTitle ||
        parsedNarrativeReport?.title ||
        (isZh ? "谣言核实结果" : "Verification Results")
      )}
    </h3>

    ${verdictLabel ? `<p style="margin:0 0 12px; line-height:1.7;"><strong>${isZh ? "结论" : "Verdict"}:</strong> ${escapeHtml(verdictLabel)}${confidence && confidence !== (isZh ? "未知" : "Unknown") ? ` <span style="color:#64748b;">(${isZh ? "置信度" : "Confidence"}: ${escapeHtml(confidence)})</span>` : ""}${primaryCitation}</p>` : ""}

    ${conclusion ? `<h3 style="font-size:1.05em; font-weight:700; color:#111827; margin:18px 0 8px;">${isZh ? "最终判断" : "Bottom Line"}</h3>${formatParagraphs(conclusion, citationRefs, summaryCitations)}` : ""}

    ${crossValidation?.agreement ? `<p style="margin:0 0 14px; line-height:1.7; color:#64748b;"><strong>${isZh ? "交叉验证" : "Cross-Validation"}:</strong> ${escapeHtml(crossValidation.agreement)}${formatCitationPills(citationRefs, analysisCitations)}</p>` : ""}

    ${summary ? `<div style="margin-bottom:18px;">
      <h3 style="font-size:1.05em; font-weight:700; color:#111827; margin:18px 0 8px;">${isZh ? "摘要" : "Summary"}</h3>
      ${formatParagraphs(summary, citationRefs, summaryCitations)}
    </div>` : ""}

    ${factItems ? `<div style="margin-bottom:18px;">
      <h3 style="font-size:1.05em; font-weight:700; color:#111827; margin:18px 0 8px;">${isZh ? "关键事实" : "Key Facts"}</h3>
      <ul style="margin:4px 0 0 18px; padding:0; list-style:disc;">${factItems}</ul>
    </div>` : ""}

    ${analysis ? `<div style="margin-bottom:18px;">
      <h3 style="font-size:1.05em; font-weight:700; color:#111827; margin:18px 0 8px;">${isZh ? "分析" : "Analysis"}</h3>
      ${formatParagraphs(analysis, citationRefs, analysisCitations)}
    </div>` : ""}

    ${fallbackMarkdown ? `<div style="margin-bottom:18px;">
      <div style="color:#374151; line-height:1.7; white-space:pre-wrap;">${formatInlineText(fallbackMarkdown)}</div>
    </div>` : ""}

    ${sourceLinks ? `<div>
      <h3 style="font-size:1.05em; font-weight:700; color:#111827; margin:18px 0 8px;">${isZh ? "来源" : "Sources"}</h3>
      <ul style="margin:4px 0 0 18px; padding:0; list-style:disc;">${sourceLinks}</ul>
    </div>` : ""}
  </div>`;
}

function getRumorVerdictTone(verdict: string): {
  accent: string;
  bg: string;
  border: string;
  label: string;
} {
  const normalized = verdict.toLowerCase();

  if (
    normalized.includes("debunk") ||
    normalized.includes("false") ||
    normalized.includes("not true") ||
    normalized.includes("辟谣") ||
    normalized.includes("不实") ||
    normalized.includes("虚假")
  ) {
    return {
      accent: "#059669",
      bg: "#ecfdf5",
      border: "#10b981",
      label: "Debunked",
    };
  }

  if (
    normalized.includes("verified") ||
    normalized.includes("true") ||
    normalized.includes("confirmed") ||
    normalized.includes("属实") ||
    normalized.includes("证实") ||
    normalized.includes("确认")
  ) {
    return {
      accent: "#dc2626",
      bg: "#fef2f2",
      border: "#f87171",
      label: "Verified",
    };
  }

  return {
    accent: "#b45309",
    bg: "#fffbeb",
    border: "#f59e0b",
    label: "Mixed / Unclear",
  };
}

function parseRumorReport(markdown: string) {
  const normalized = markdown.replace(/\r\n/g, "\n").trim();
  const verdict = extractMarkdownField(normalized, ["Verdict", "结论"]);
  const summary = extractMarkdownSection(normalized, ["Summary", "摘要"]);
  const keyFacts = extractMarkdownSection(normalized, ["Key Facts", "关键事实"])
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => /^[-*]\s+/.test(line))
    .map((line) => line.replace(/^[-*]\s+/, "").trim());
  const analysis = extractMarkdownSection(normalized, ["Analysis", "分析"]);
  const conclusion = extractMarkdownSection(normalized, ["Conclusion", "结论"]);
  const sources = extractMarkdownSection(normalized, ["Sources", "来源"])
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => /^[-*]\s+/.test(line))
    .map((line) => line.replace(/^[-*]\s+/, "").trim());

  const verdictConfidence =
    verdict.match(/\(Confidence:\s*([^)]+)\)/i)?.[1]?.trim() ||
    verdict.match(/（?置信度[:：]\s*([^)）]+)\)?/i)?.[1]?.trim() ||
    conclusion.match(/Confidence:\s*([A-Za-z]+)/i)?.[1]?.trim() ||
    conclusion.match(/置信度[:：]\s*([^\s，。]+)/i)?.[1]?.trim() ||
    "";

  return {
    entity: extractMarkdownField(normalized, ["Entity", "实体"]),
    date: extractMarkdownField(normalized, ["Date", "日期"]),
    rumor: extractMarkdownField(normalized, ["Rumor", "传闻"]),
    verdict,
    verdictLabel: verdict.replace(/\s*(\(|（)\s*(Confidence|置信度)[:：]\s*[^)）]+(\)|）)/i, "").trim(),
    confidence: verdictConfidence,
    summary,
    keyFacts,
    analysis,
    conclusion,
    sources,
  };
}

function parseRumorNarrativeReport(text: string) {
  const normalized = text.replace(/\r\n/g, "\n").trim();
  const sectionNames = ["Summary", "Facts", "Analysis", "Conclusion", "Source link"];
  const summary = extractPlainSection(normalized, "Summary", sectionNames);
  const facts = extractPlainSection(normalized, "Facts", sectionNames)
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => /^\d+\)\s+/.test(line) || /^[-*]\s+/.test(line))
    .map((line) => line.replace(/^(\d+\)|[-*])\s+/, "").trim());
  const analysis = extractPlainSection(normalized, "Analysis", sectionNames);
  const conclusion = extractPlainSection(normalized, "Conclusion", sectionNames);
  const sourceLink = extractPlainSection(normalized, "Source link", sectionNames);
  const verdict = extractPlainField(normalized, "Result");
  const verdictLabel = extractPlainField(normalized, "Label") || verdict;
  const confidence =
    conclusion.match(/Confidence level:\s*([A-Za-z ]+)/i)?.[1]?.trim() ||
    conclusion.match(/Confidence:\s*([A-Za-z ]+)/i)?.[1]?.trim() ||
    "";
  const rumorMatch = normalized.match(
    /(?:^|\n)Rumor:\s*\n?([\s\S]*?)(?=\n(?:Result:|Summary\n|Facts\n|Analysis\n|Conclusion\n|Source link\n)|$)/i,
  );
  const rumorText = rumorMatch?.[1]?.trim().replace(/^"|"$/g, "") || "";

  return {
    title: normalized.split("\n")[0]?.trim() || "",
    date: extractPlainField(normalized, "Date"),
    rumor: rumorText,
    verdict,
    verdictLabel,
    confidence,
    summary,
    keyFacts: facts,
    analysis,
    conclusion,
    sources: sourceLink
      .split(";")
      .map((item) => item.trim())
      .filter(Boolean),
  };
}

function formatRumorSourceCard(url: string, index: number = 0): string {
  const safeUrl = escapeHtml(url);
  const label = `Source ${index + 1}`;
  return `<a href="${safeUrl}" target="_blank" rel="noopener noreferrer" style="display:inline-flex; align-items:center; gap:6px; text-decoration:none; background:#f8fafc; border:1px solid #e2e8f0; border-radius:8px; padding:8px 14px; font-size:13px; font-weight:600; color:#0f766e;">
    ↗ ${label}
  </a>`;
}

function formatRumorEarningsVerificationCard(data: any, language: string = "en"): string {
  const isZh = language === "zh";
  const earningsVerification = data.earnings_verification || data.data?.earnings_verification;

  if (!earningsVerification || (earningsVerification.status !== "success" && !earningsVerification.summary)) {
    return "";
  }

  const verdict = earningsVerification.verdict || (isZh ? "已获取" : "Available");
  const summary = earningsVerification.summary || "";
  const relevantInfo = earningsVerification.relevant_info || "";
  const evidence = earningsVerification.evidence || "";

  const verdictTone =
    /support/i.test(verdict)
      || /支持|证实|确认/.test(verdict)
      ? { bg: "#ecfdf5", border: "#10b981", text: "#047857" }
      : /contradict|refute|oppose/i.test(verdict) || /反驳|否认|不支持/.test(verdict)
        ? { bg: "#fef2f2", border: "#f87171", text: "#b91c1c" }
        : { bg: "#eff6ff", border: "#60a5fa", text: "#1d4ed8" };

  return `<div style="margin-bottom:18px; padding:16px; background:#f8fafc; border:1px solid #cbd5e1; border-radius:12px;">
    <div style="display:flex; align-items:center; gap:10px; margin-bottom:12px; flex-wrap:wrap;">
      <div style="font-size:18px; font-weight:700; color:#334155;">📞 ${isZh ? "财报电话会验证" : "Earnings Call Verification"}</div>
      <span style="display:inline-block; padding:4px 8px; font-size:12px; font-weight:700; color:${verdictTone.text}; background:${verdictTone.bg}; border:1px solid ${verdictTone.border}; border-radius:999px;">${escapeHtml(verdict)}</span>
    </div>
    ${summary ? `<div style="margin-bottom:12px; padding:12px 14px; background:white; border:1px solid #e5e7eb; border-radius:10px; color:#475569; line-height:1.7;">${formatInlineText(summary)}</div>` : ""}
    ${relevantInfo ? `<div style="margin-bottom:12px; color:#374151; line-height:1.7;">${formatInlineText(relevantInfo)}</div>` : ""}
    ${evidence ? `<details style="background:white; border:1px solid #d1d5db; border-radius:10px; padding:10px 12px;">
      <summary style="cursor:pointer; font-weight:600; color:#334155;">${isZh ? "查看证据" : "View evidence"}</summary>
      <div style="margin-top:12px; color:#475569; line-height:1.7; white-space:normal;">${formatInlineText(evidence)}</div>
    </details>` : ""}
  </div>`;
}
