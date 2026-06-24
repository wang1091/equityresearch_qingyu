// server/agent/formatters/earnings.ts
// Extracted verbatim from cardFormatter.ts (per-source split) — no behavior change.
import {
  escapeHtmlCell,
  escapeHtml,
  renderAnswerMarkdown,
  formatErrorCard,
} from "./_shared";

export function formatEarningsCard(data: any, language: string = "en"): string {
  console.log("📋 EARNINGS keys:", Object.keys(data));
  if (data?.topic === "calendar" && data?.range && Array.isArray(data?.days)) {
    return formatRangeCalendarCard(data, language);
  }
  if (data?.topic === "calendar" && data?.calendar) {
    return formatNasdaqEarningsCalendarCard(data, language);
  }
  if (data?.topic === "multi_quarter_ask") {
    return formatMultiQuarterAskCard(data, language);
  }
  if (data?.topic === "ask") {
    return formatAskCard(data, language);
  }
  console.log("📋 EARNINGS data.data keys:", data.data ? Object.keys(data.data) : "no data.data");
  const earningsData = data.data || data;
  console.log("📋 earningsData keys:", Object.keys(earningsData));
  console.log("📋 has transcript_split:", !!earningsData.transcript_split);
  console.log("📋 has participants:", !!earningsData.participants);
  const ticker = data.ticker || earningsData?.ticker || "N/A";
  const year = data.year || earningsData?.year || "";
  const quarter = data.quarter || earningsData?.quarter || "";
  const periodLabel = year && quarter ? `${year} Q${quarter}` : "";
  const isZh = language === "zh";

  // 格式1: Full Transcript
  if (earningsData.transcript_split || earningsData.transcriptSplit || earningsData.transcript || earningsData.participants) {
    return formatTranscriptCard(earningsData, ticker, year, quarter, language);
  }

  // 格式2: Transcript QA
  if (
    typeof earningsData.answer === "string" &&
    (Array.isArray(earningsData.citations) ||
      Array.isArray(earningsData.highlightPhrases) ||
      typeof earningsData.hasAnswer === "boolean")
  ) {
    return formatTranscriptQACard(earningsData, ticker, year, quarter, language);
  }

  // 格式3: Q&A
  if (earningsData.items && Array.isArray(earningsData.items)) {
    return formatQACard(earningsData, ticker, year, quarter, language);
  }

  // 格式4: Summary
  const sections = Array.isArray(earningsData) ? earningsData : earningsData?.sections;
  if (sections && Array.isArray(sections) && sections.length > 0 && sections[0]?.heading) {
    return formatSummaryCard(sections, ticker, periodLabel, language);
  }

  // 格式5: 纯文本 response
  if (data.response && typeof data.response === "string") {
    return data.response;
  }

  // 格式6: 纯文本 data
  if (typeof earningsData === "string" && earningsData.length > 0) {
    const formatted = earningsData
      .replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>")
      .replace(/\n/g, "<br>");

    const label = isZh ? "财报分析" : "Earnings Analysis";
    return `<strong>📞 ${label} - ${ticker}</strong><br><br>
      <div style="line-height: 1.6;">${formatted}</div>`;
  }

  const noDataMsg = isZh ? "暂无财报数据" : "No earnings data available";
  return formatErrorCard("EARNINGS", noDataMsg);
}

function formatNasdaqEarningsCalendarCard(data: any, language: string = "en"): string {
  const isZh = language === "zh";
  const cal = data.calendar;
  const rows: any[] = Array.isArray(cal?.rows) ? cal.rows : [];
  const date = escapeHtmlCell(data.date || "");
  const asOf = escapeHtmlCell(cal?.asOf || "");
  const title = isZh ? "美股财报发布日程" : "US Earnings Calendar";
  const sub = isZh
    ? `日期 ${date} · Nasdaq · ${rows.length} 家`
    : `Date ${date} · Nasdaq · ${rows.length} companies`;

  const maxRows = 80;
  const slice = rows.slice(0, maxRows);

  const th = (a: string, b: string) =>
    `<th style="padding:8px 10px;text-align:left;font-size:12px;color:#6b7280;border-bottom:1px solid #e5e7eb;">${isZh ? a : b}</th>`;

  const head = `<tr>${th("代码", "Symbol")}${th("公司", "Company")}${th("时间", "Time")}${th("财季结束", "FQ End")}${th("实际EPS", "EPS")}${th("一致预期", "Est.")}</tr>`;

  const body = slice
    .map((r) => {
      const sym = escapeHtmlCell(r.symbol);
      const name = escapeHtmlCell(r.name);
      const time = escapeHtmlCell(r.time);
      const fq = escapeHtmlCell(r.fiscalQuarterEnding);
      const eps = escapeHtmlCell(r.eps);
      const fc = escapeHtmlCell(r.epsForecast);
      return `<tr style="border-bottom:1px solid #f3f4f6;"><td style="padding:8px 10px;font-weight:600;">${sym}</td><td style="padding:8px 10px;">${name}</td><td style="padding:8px 10px;font-size:12px;">${time}</td><td style="padding:8px 10px;font-size:12px;">${fq}</td><td style="padding:8px 10px;">${eps}</td><td style="padding:8px 10px;">${fc}</td></tr>`;
    })
    .join("");

  const more =
    rows.length > maxRows
      ? `<p style="margin-top:10px;font-size:12px;color:#6b7280;">${isZh ? `仅显示前 ${maxRows} 条，共 ${rows.length} 条。` : `Showing first ${maxRows} of ${rows.length} rows.`}</p>`
      : "";

  return `
  <div style="font-family: system-ui, -apple-system, sans-serif; border: 1px solid #e5e7eb; border-radius: 12px; overflow: hidden; background: #fff;">
    <div style="padding: 16px 20px; border-bottom: 1px solid #e5e7eb; background: #f9fafb;">
      <div style="font-size: 18px; font-weight: 600; color: #1f2937;">📅 ${title}</div>
      <div style="font-size: 13px; color: #6b7280; margin-top: 4px;">${sub}</div>
      ${asOf ? `<div style="font-size: 12px; color: #9ca3af; margin-top: 2px;">${isZh ? "数据截至" : "As of"} ${asOf}</div>` : ""}
      <div style="font-size: 11px; color: #9ca3af; margin-top: 2px;">${isZh ? "🇺🇸 日期为美东时间 (ET)" : "🇺🇸 Dates in US Eastern (ET)"}</div>
    </div>
    <div style="padding: 12px; overflow-x: auto;">
      <table style="width:100%; border-collapse:collapse; font-size: 13px;">${head}${body || `<tr><td colspan="6" style="padding:16px;color:#6b7280;">${isZh ? "该日暂无财报安排（或数据未返回）。" : "No earnings scheduled for this date (or empty response)."}</td></tr>`}</table>
      ${more}
    </div>
  </div>`;
}

// Range calendar (week / month / quarter): companies grouped by date, capped.
// Tickers-only — the SmartNews month endpoint does not carry company names.
function formatRangeCalendarCard(data: any, language: string = "en"): string {
  const isZh = language === "zh";
  const range = data.range || {};
  const days: Array<{ date: string; companies: Array<{ symbol: string; time: string }> }> =
    Array.isArray(data.days) ? data.days : [];
  const total = Number(data.totalCompanies || 0);
  const shown = Number(data.shownCompanies || 0);
  const title = isZh ? "财报日历" : "Earnings Calendar";
  const label = escapeHtmlCell(range.label || "");
  const sub = isZh
    ? `${escapeHtmlCell(range.start)} 至 ${escapeHtmlCell(range.end)} · 共 ${total} 家`
    : `${escapeHtmlCell(range.start)} → ${escapeHtmlCell(range.end)} · ${total} companies`;

  const timing = (t: string) => {
    const s = (t || "").toLowerCase();
    if (s.includes("pre")) return isZh ? "盘前" : "AM";
    if (s.includes("post")) return isZh ? "盘后" : "PM";
    return "";
  };
  const chip = (sym: string, tm: string) =>
    `<span style="display:inline-block;padding:3px 8px;margin:2px;border-radius:6px;background:#f3f4f6;font-size:12px;color:#374151;">${escapeHtmlCell(sym)}${tm ? ` <span style="color:#9ca3af;">${tm}</span>` : ""}</span>`;

  const dayBlocks = days
    .map((d) => {
      const chips = d.companies.map((c) => chip(c.symbol, timing(c.time))).join("");
      return `<div style="margin:10px 0;"><div style="font-weight:600;font-size:13px;color:#374151;margin-bottom:4px;">${escapeHtmlCell(d.date)} · ${d.companies.length}</div><div>${chips}</div></div>`;
    })
    .join("");

  const more =
    total > shown
      ? `<p style="margin-top:10px;font-size:12px;color:#6b7280;">${isZh ? `仅显示前 ${shown} 家，共 ${total} 家。` : `Showing first ${shown} of ${total} companies.`}</p>`
      : "";

  const emptyMsg = isZh ? "该区间暂无财报安排。" : "No earnings scheduled in this range.";

  return `
  <div style="font-family: system-ui, -apple-system, sans-serif; border: 1px solid #e5e7eb; border-radius: 12px; overflow: hidden; background: #fff;">
    <div style="padding: 16px 20px; border-bottom: 1px solid #e5e7eb; background: #f9fafb;">
      <div style="font-size: 18px; font-weight: 600; color: #1f2937;">📅 ${title}${label ? ` — ${label}` : ""}</div>
      <div style="font-size: 13px; color: #6b7280; margin-top: 4px;">${sub}</div>
      <div style="font-size: 11px; color: #9ca3af; margin-top: 2px;">${isZh ? "🇺🇸 日期为美东时间 (ET)" : "🇺🇸 Dates in US Eastern (ET)"}</div>
    </div>
    <div style="padding: 12px 16px;">
      ${dayBlocks || `<div style="padding:8px;color:#6b7280;">${emptyMsg}</div>`}
      ${more}
    </div>
  </div>`;
}

function formatAskCard(data: any, language: string = "en"): string {
  const isZh = language === "zh";
  const ticker = typeof data?.ticker === "string" ? data.ticker : "";
  const year = data?.year ?? "";
  const quarter =
    typeof data?.quarter === "string"
      ? data.quarter
      : typeof data?.quarter === "number"
        ? `Q${data.quarter}`
        : "";
  const periodLabel = year && quarter ? `${quarter} ${year}` : year ? `${year}` : quarter;

  const answer =
    typeof data?.answer === "string" && data.answer.trim().length > 0
      ? data.answer
      : isZh
        ? "未获取到有效回答。"
        : "No answer available.";
  const hasAnswer = data?.hasAnswer !== false && answer.trim().length > 0;
  const source = typeof data?.source === "string" ? data.source : "";
  const references: string[] = Array.isArray(data?.references)
    ? data.references.filter((r: any) => typeof r === "string" && r.trim().length > 0)
    : [];
  const citations: any[] = Array.isArray(data?.citations) ? data.citations : [];
  const thinking = typeof data?.thinking === "string" ? data.thinking.trim() : "";

  const sourcePillLabel = (() => {
    if (source === "calendar") return isZh ? "财报日历" : "Earnings Calendar";
    if (source === "web") return isZh ? "网络/RAG" : "Web / RAG";
    if (source === "transcript") return isZh ? "财报电话" : "Transcript";
    if (source === "error") return isZh ? "服务异常" : "Service Error";
    return isZh ? "智能问答" : "Ask Checkit";
  })();
  const sourcePillBg =
    source === "calendar"
      ? "#ecfdf5"
      : source === "web"
        ? "#eff6ff"
        : source === "error"
          ? "#fef2f2"
          : "#f3f4f6";
  const sourcePillColor =
    source === "calendar"
      ? "#047857"
      : source === "web"
        ? "#1d4ed8"
        : source === "error"
          ? "#b91c1c"
          : "#374151";
  const sourcePillBorder =
    source === "calendar"
      ? "#a7f3d0"
      : source === "web"
        ? "#bfdbfe"
        : source === "error"
          ? "#fecaca"
          : "#e5e7eb";

  const title = isZh ? "财报问答" : "Earnings Q&A";
  const answerLabel = isZh ? "回答" : "Answer";
  const referencesLabel = isZh ? "参考" : "References";
  const thinkingLabel = isZh ? "推理过程" : "Thinking";
  const noAnswerNotice = isZh
    ? "未能在财报数据中找到该问题的明确答案。"
    : "Could not find an explicit answer in the earnings data.";

  let html = `<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; border: 1px solid #e5e7eb; border-radius: 10px; background: #fff; padding: 18px;">`;
  html += `<div style="display: flex; align-items: center; gap: 8px; margin-bottom: 6px;">`;
  html += `<div style="font-size: 18px; font-weight: 700; color: #111827;">📞 ${title}</div>`;
  html += `<span style="font-size: 11px; font-weight: 600; padding: 2px 8px; border-radius: 9999px; background: ${sourcePillBg}; color: ${sourcePillColor}; border: 1px solid ${sourcePillBorder};">${escapeHtml(sourcePillLabel)}</span>`;
  html += `</div>`;
  if (ticker || periodLabel) {
    html += `<div style="font-size: 13px; color: #6b7280; margin-bottom: 14px;">${escapeHtml(ticker)}${periodLabel ? ` · ${escapeHtml(String(periodLabel))}` : ""}</div>`;
  }

  html += `<div style="margin-bottom: 12px; padding: 12px; background: ${hasAnswer ? "#eff6ff" : "#fefce8"}; border-radius: 8px; border: 1px solid ${hasAnswer ? "#bfdbfe" : "#fde68a"};">
    <div style="font-size: 12px; font-weight: 700; color: ${hasAnswer ? "#1d4ed8" : "#a16207"}; margin-bottom: 6px;">${answerLabel}</div>
    <div style="font-size: 14px; color: #1f2937; line-height: 1.7;" class="ask-card-answer">${renderAnswerMarkdown(answer)}</div>
  </div>`;

  if (!hasAnswer) {
    html += `<div style="font-size: 12px; color: #92400e; margin-bottom: 12px;">${noAnswerNotice}</div>`;
  }

  if (references.length > 0) {
    const shownRefs = references.slice(0, 5);
    html += `<details style="margin-top: 8px;">
      <summary style="cursor: pointer; font-size: 12px; font-weight: 700; color: #6b7280;">${referencesLabel} (${shownRefs.length})</summary>
      <div style="display: flex; flex-direction: column; gap: 6px; margin-top: 6px;">`;
    shownRefs.forEach((ref: string) => {
      html += `<div style="font-size: 13px; color: #1f2937; padding: 8px 10px; background: #f8fafc; border: 1px solid #e5e7eb; border-radius: 6px;">${escapeHtml(ref)}</div>`;
    });
    html += `</div></details>`;
  }

  if (citations.length > 0) {
    const shownCitations = citations.slice(0, 5).filter(
      (c: any) => (typeof c?.quote === "string" ? c.quote : typeof c === "string" ? c : "").length > 0,
    );
    if (shownCitations.length > 0) {
      html += `<details style="margin-top: 8px;">
        <summary style="cursor: pointer; font-size: 12px; font-weight: 700; color: #6b7280;">${isZh ? "引用" : "Citations"} (${shownCitations.length})</summary>
        <div style="display: flex; flex-direction: column; gap: 6px; margin-top: 6px;">`;
      shownCitations.forEach((c: any, i: number) => {
        const id = c?.id ?? i + 1;
        const quote = typeof c?.quote === "string" ? c.quote : typeof c === "string" ? c : "";
        html += `<div style="padding: 8px 10px; background: #f8fafc; border: 1px solid #e5e7eb; border-radius: 6px;">
          <div style="font-size: 11px; font-weight: 600; color: #475569; margin-bottom: 2px;">[${id}]</div>
          <div style="font-size: 13px; color: #1f2937; line-height: 1.5;">${escapeHtml(quote)}</div>
        </div>`;
      });
      html += `</div></details>`;
    }
  }

  if (thinking.length > 0) {
    html += `<details style="margin-top: 10px;">
      <summary style="cursor: pointer; font-size: 12px; font-weight: 600; color: #6b7280;">${thinkingLabel}</summary>
      <div style="margin-top: 6px; padding: 10px; background: #f8fafc; border: 1px solid #e5e7eb; border-radius: 6px; font-size: 12px; color: #475569; line-height: 1.6;">${escapeHtml(thinking).replace(/\n/g, "<br>")}</div>
    </details>`;
  }

  html += `</div>`;
  return html;
}

function formatMultiQuarterAskCard(data: any, language: string = "en"): string {
  const isZh = language === "zh";
  const ticker = data.ticker || "N/A";
  const year = data.year || "";
  const quarters: any[] = Array.isArray(data.quarters) ? data.quarters : [];

  const headerLabel = isZh ? "多季度财报数据" : "Multi-Quarter Earnings";
  const noDataLabel = isZh ? "暂无数据" : "No data available";

  const rows = quarters.map((q: any) => {
    const label = `${q.quarter}${year ? ` ${q.year ?? year}` : ""}`;
    const answer = q.hasAnswer && q.answer ? escapeHtml(String(q.answer)) : `<span style="color:#9ca3af;">${noDataLabel}</span>`;
    return `
      <tr style="border-bottom:1px solid #e5e7eb;">
        <td style="padding:10px 14px; font-weight:600; color:#4f46e5; white-space:nowrap; vertical-align:top;">${label}</td>
        <td style="padding:10px 14px; font-size:13px; color:#374151; line-height:1.6;">${answer}</td>
      </tr>`;
  }).join("");

  return `
    <div style="background:#fff; border-radius:12px; box-shadow:0 2px 10px rgba(0,0,0,0.08); overflow:hidden; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
      <div style="background:linear-gradient(135deg,#4f46e5 0%,#7c3aed 100%); padding:14px 18px; color:#fff;">
        <div style="font-size:15px; font-weight:700;">📊 ${headerLabel} — ${ticker}</div>
        ${data.question ? `<div style="font-size:11px; opacity:0.8; margin-top:4px;">${escapeHtml(String(data.question).slice(0, 120))}</div>` : ""}
      </div>
      <div style="overflow-x:auto;">
        <table style="width:100%; border-collapse:collapse; font-size:13px;">
          <thead>
            <tr style="background:#f8fafc; border-bottom:2px solid #e2e8f0;">
              <th style="padding:10px 14px; text-align:left; color:#6b7280; font-size:11px; text-transform:uppercase; letter-spacing:0.05em; white-space:nowrap;">${isZh ? "季度" : "Quarter"}</th>
              <th style="padding:10px 14px; text-align:left; color:#6b7280; font-size:11px; text-transform:uppercase; letter-spacing:0.05em;">${isZh ? "答复" : "Answer"}</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    </div>`;
}

function formatSummaryCard(sections: any[], ticker: string, periodLabel: string, language: string = "en"): string {
  const isZh = language === "zh";
  const title = isZh ? "财报摘要" : "Earnings Summary";
  let html = `
  <div style="font-family: system-ui, -apple-system, sans-serif; border: 1px solid #e5e7eb; border-radius: 12px; overflow: hidden; background: #fff;">
    <div style="padding: 16px 20px; border-bottom: 1px solid #e5e7eb; background: #f9fafb;">
      <div style="font-size: 18px; font-weight: 600; color: #1f2937;">
        📞 ${title}
        <span style="font-size: 14px; font-weight: 400; color: #6b7280; margin-left: 8px;">
          ${ticker}${periodLabel ? ` - ${periodLabel}` : ""}
        </span>
      </div>
    </div>
    <div style="padding: 12px;">
      ${sections
        .map((section: any, idx: number) => {
          const isRedFlag = /red flag|风险提示/i.test(section.heading || "");
          const summaryBg = isRedFlag ? "#fef2f2" : "#f3f4f6";
          const summaryColor = isRedFlag ? "#dc2626" : "#374151";
          const bulletColor = isRedFlag ? "#dc2626" : "#2563eb";
          const textColor = isRedFlag ? "#991b1b" : "#374151";

          return `
      <details ${idx === 0 ? "open" : ""} style="margin-bottom: 8px;">
        <summary style="cursor: pointer; padding: 12px 16px; border-radius: 8px; font-weight: 600; font-size: 14px; background: ${summaryBg}; color: ${summaryColor}; border: 1px solid ${isRedFlag ? "#fecaca" : "#e5e7eb"}; list-style: none;">
          ${section.heading}
        </summary>
        <div style="padding: 16px; margin-top: 4px; border-radius: 8px; background: ${isRedFlag ? "#fef2f2" : "#ffffff"}; border: 1px solid ${isRedFlag ? "#fecaca" : "#e5e7eb"};">
          ${(section.bullets || [])
            .map(
              (bullet: string) => `
          <div style="display: flex; align-items: flex-start; gap: 10px; margin-bottom: 12px; line-height: 1.6; font-size: 14px; color: ${textColor};">
            <span style="color: ${bulletColor}; flex-shrink: 0; margin-top: 2px;">•</span>
            <span style="flex: 1;">${bullet}</span>
          </div>`,
            )
            .join("")}
        </div>
      </details>`;
        })
        .join("")}
    </div>
  </div>`;

  return html;
}

function formatTranscriptQACard(
  data: any,
  ticker: string,
  year: string,
  quarter: string,
  language: string = "en"
): string {
  const isZh = language === "zh";
  const escapeHtml = (text: string): string =>
    text
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");

  const answer =
    typeof data.answer === "string" && data.answer.trim().length > 0
      ? data.answer
      : isZh
        ? "会议记录中未获取到有效回答。"
        : "No answer available from transcript.";

  const citations = Array.isArray(data.citations) ? data.citations : [];
  const highlightPhrases = Array.isArray(data.highlightPhrases)
    ? data.highlightPhrases
    : [];
  const hasAnswer = data.hasAnswer !== false;
  const title = isZh ? "财报电话会分析" : "Earnings Call Analysis";
  const answerLabel = isZh ? "回答" : "Answer";
  const citationsLabel = isZh ? "引用片段" : "Citations";
  const highlightsLabel = isZh ? "关键词" : "Highlights";
  const noAnswerNotice = isZh
    ? "该问题在当前会议记录中没有明确提及。"
    : "This transcript does not explicitly contain the requested information.";
  const periodLabel = year && quarter ? `${year} Q${quarter}` : "";

  let html = `<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; border: 1px solid #e5e7eb; border-radius: 10px; background: #fff; padding: 18px;">`;
  html += `<div style="font-size: 18px; font-weight: 700; color: #111827; margin-bottom: 6px;">📞 ${title}</div>`;
  html += `<div style="font-size: 13px; color: #6b7280; margin-bottom: 14px;">${escapeHtml(ticker)}${periodLabel ? ` - ${escapeHtml(periodLabel)}` : ""}</div>`;

  html += `<div style="margin-bottom: 12px; padding: 12px; background: ${hasAnswer ? "#eff6ff" : "#fefce8"}; border-radius: 8px; border: 1px solid ${hasAnswer ? "#bfdbfe" : "#fde68a"};">
    <div style="font-size: 12px; font-weight: 700; color: ${hasAnswer ? "#1d4ed8" : "#a16207"}; margin-bottom: 6px;">${answerLabel}</div>
    <div style="font-size: 14px; color: #1f2937; line-height: 1.7;" class="ask-card-answer">${renderAnswerMarkdown(answer)}</div>
  </div>`;

  if (!hasAnswer) {
    html += `<div style="font-size: 12px; color: #92400e; margin-bottom: 12px;">${noAnswerNotice}</div>`;
  }

  if (highlightPhrases.length > 0) {
    html += `<div style="margin-bottom: 12px;">
      <div style="font-size: 12px; font-weight: 700; color: #6b7280; margin-bottom: 6px;">${highlightsLabel}</div>
      <div style="display: flex; flex-wrap: wrap; gap: 6px;">`;
    highlightPhrases.slice(0, 6).forEach((phrase: string) => {
      html += `<span style="font-size: 12px; color: #374151; background: #f3f4f6; border: 1px solid #e5e7eb; border-radius: 9999px; padding: 4px 10px;">${escapeHtml(String(phrase))}</span>`;
    });
    html += `</div></div>`;
  }

  if (citations.length > 0) {
    html += `<div style="margin-top: 4px;">
      <div style="font-size: 12px; font-weight: 700; color: #6b7280; margin-bottom: 8px;">${citationsLabel}</div>
      <div style="display: flex; flex-direction: column; gap: 8px;">`;
    citations.slice(0, 5).forEach((citation: any, index: number) => {
      const id = citation?.id || index + 1;
      const quote = typeof citation?.quote === "string" ? citation.quote : "";
      const position =
        typeof citation?.position === "number"
          ? citation.position
          : undefined;
      html += `<div style="padding: 10px; background: #f8fafc; border: 1px solid #e5e7eb; border-radius: 8px;">
        <div style="font-size: 12px; font-weight: 600; color: #475569; margin-bottom: 4px;">[${id}]${position !== undefined ? ` · pos ${position}` : ""}</div>
        <div style="font-size: 13px; color: #1f2937; line-height: 1.6;">${escapeHtml(quote)}</div>
      </div>`;
    });
    html += `</div></div>`;
  }

  html += `</div>`;
  return html;
}

function formatQACard(data: any, ticker: string, year: string, quarter: string, language: string = "en"): string {
  const isZh = language === "zh";
  let html = `<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;">`;

  if (data.conclusion) {
    const conclusionTitle = isZh ? "总体结论" : "Overall Conclusion";
    html += `
<div style="border:1px solid #e5e7eb; border-radius:8px; padding:20px; margin-bottom:20px; background:#fff;">
  <h3 style="margin:0 0 12px; font-size:18px; font-weight:700; color:#1e40af;">${conclusionTitle}</h3>
  <p style="margin:0; color:#374151; font-size:14px; line-height:1.7;">${data.conclusion}</p>
</div>`;
  }

  if (data.items && Array.isArray(data.items)) {
    const qaTitle = isZh ? "问答环节" : "Q&A Session";
    const questionsLabel = isZh ? `${data.items.length} 个问题` : `${data.items.length} questions`;
    html += `
<div style="border:1px solid #e5e7eb; border-radius:8px; padding:20px; background:#fff;">
  <div style="margin-bottom:16px; display:flex; align-items:baseline; gap:8px;">
    <span style="font-size:18px; font-weight:700; color:#111827;">${qaTitle}</span>
    <span style="font-size:15px; color:#111827;">${ticker} - ${year} Q${quarter}</span>
    <span style="font-size:14px; color:#9ca3af;">(${questionsLabel})</span>
  </div>

  <div style="display:flex; flex-direction:column; gap:16px;">`;

    const questionLabel = isZh ? "提问：" : "Question:";
    const responseLabel = isZh ? "回答：" : "Response:";
    const sentimentLabel = isZh ? "情绪" : "Sentiment";
    const unknownAnalyst = isZh ? "未知分析师" : "Unknown Analyst";
    const unknownFirm = isZh ? "未知机构" : "Unknown Firm";

    data.items.slice(0, 10).forEach((item: any, idx: number) => {
      const sentiment = item.sentiment || 5;
      let sentimentBg, sentimentColor;
      if (sentiment >= 7) { sentimentBg = "#dcfce7"; sentimentColor = "#166534"; }
      else if (sentiment >= 6) { sentimentBg = "#dbeafe"; sentimentColor = "#1e40af"; }
      else { sentimentBg = "#fef9c3"; sentimentColor = "#854d0e"; }

      html += `
<div style="border:1px solid #e5e7eb; border-radius:8px; overflow:hidden;">
  <div style="padding:10px 16px; background:#f9fafb; display:flex; align-items:center; gap:8px; flex-wrap:wrap;">
    <span style="font-size:12px; font-weight:600; color:#6b7280; background:#e5e7eb; padding:2px 7px; border-radius:4px;">#${item.index || idx + 1}</span>
    <span style="font-weight:700; color:#111827; font-size:14px;">${item.analyst || unknownAnalyst}</span>
    <span style="font-size:13px; color:#6b7280;">${item.firm || unknownFirm}</span>
    <span style="font-size:12px; padding:2px 10px; border-radius:9999px; background:${sentimentBg}; color:${sentimentColor}; margin-left:auto; font-weight:600;">
      ${sentimentLabel}: ${sentiment}
    </span>
  </div>

  <div style="padding:14px 16px; border-top:1px solid #e5e7eb;">
    <p style="font-size:13px; font-weight:700; color:#374151; margin:0 0 6px;">${questionLabel}</p>
    <p style="margin:0; color:#1f2937; line-height:1.6; font-size:14px;">${item.question}</p>
  </div>

  <div style="padding:14px 16px; border-top:1px solid #e5e7eb; background:#fafafa;">
    <p style="font-size:13px; font-weight:700; color:#374151; margin:0 0 6px;">${responseLabel}</p>
    <p style="margin:0; color:#374151; line-height:1.7; font-size:14px;">${item.response}</p>
  </div>
</div>`;
    });

    if (data.items.length > 10) {
      const showingLabel = isZh
        ? `显示 ${data.items.length} 个问题中的前 10 个`
        : `Showing 10 of ${data.items.length} questions`;
      html += `<p style="text-align:center; color:#6b7280; font-size:14px; margin:0;">${showingLabel}</p>`;
    }

    html += `</div></div>`;
  }

  html += `</div>`;
  return html;
}

function formatTranscriptCard(data: any, ticker: string, year: string, quarter: string, language: string = "en"): string {
  // HTML escape helper function
  const escapeHtml = (text: string): string => {
    return text
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  };

  // Debug logging
  console.log("📋 formatTranscriptCard called");
  const segments = data.transcript_split || data.transcriptSplit || [];
  console.log("📋 segments length:", segments.length);
  console.log("📋 participants length:", data.participants?.length);
  if (segments.length > 0) {
    console.log("📋 first segment:", JSON.stringify(segments[0]).substring(0, 200));
  }

  let html = `<div style="font-family: system-ui, sans-serif;">`;

  // Header
  const companyName = escapeHtml(data.metadata?.companyName || ticker);
  const safeTicker = escapeHtml(ticker);
  html += `<div style="margin-bottom: 16px;">
    <h2 style="font-size: 24px; font-weight: 600; color: #0f172a; margin-bottom: 4px;">
      ${companyName} (${safeTicker})
    </h2>
    <p style="font-size: 14px; color: #64748b; margin: 0;">
      ${year} Q${quarter} ${language === "zh" ? "财报电话会议" : "Earnings Call"} · ${data.metadata?.earningsTimingDisplay || (language === "zh" ? "盘中" : "During Market")} · ${data.metadata?.callDate || (language === "zh" ? "日期待定" : "Date TBD")}
    </p>
  </div>`;

  // Participants
  if (data.participants && data.participants.length > 0) {
    const participantsLabel = language === "zh" ? "参会人员" : "Participants";
    html += `<details style="margin-bottom: 16px; border: 1px solid #e2e8f0; border-radius: 8px; background: #fff;">
      <summary style="cursor: pointer; padding: 12px 16px; font-weight: 500; color: #334155;">
        ${participantsLabel} (${data.participants.length})
      </summary>
      <div style="padding: 12px 16px; border-top: 1px solid #f1f5f9;">
        <ul style="margin: 0; padding-left: 16px; list-style: none;">`;

    data.participants.forEach((p: any) => {
      const safeName = escapeHtml(p.name || "Unknown");
      const safeRole = p.role ? escapeHtml(p.role) : "";
      const safeCompany = p.company ? escapeHtml(p.company) : "";
      html += `<li style="padding: 4px 0; font-size: 14px;">
        <span style="color: #2563eb;">${safeName}</span>
        ${safeRole ? `<span style="color: #64748b;"> — ${safeRole}${safeCompany ? `, ${safeCompany}` : ""}</span>` : ""}
      </li>`;
    });

    html += `</ul></div></details>`;
  }

  // Transcript Segments
  if (segments.length > 0) {
    html += `<div style="display: flex; flex-direction: column; gap: 16px;">`;

    segments.forEach((segment: any) => {
      const role = (segment.role || "").toLowerCase();
      const isAnalyst = /analyst|research|bank|capital|securities/.test(role);
      const isManagement = /ceo|cfo|coo|cto|chief|president|vp|ir|operator|management|executive/.test(role);

      const alignment = isAnalyst ? "flex-end" : "flex-start";
      const bgColor = isAnalyst ? "#eff6ff" : isManagement ? "#ecfdf5" : "#f8fafc";
      const textColor = isAnalyst ? "#1e40af" : isManagement ? "#065f46" : "#1e293b";

      // Escape all dynamic text content
      const safeRole = segment.role ? escapeHtml(segment.role) : "";
      const safeSpeaker = escapeHtml(segment.speaker || segment.company || "Unknown");
      const safeText = escapeHtml(segment.text || "");

      html += `<div style="display: flex; flex-direction: column; align-items: ${alignment}; gap: 4px;">
        <div style="display: flex; align-items: center; gap: 8px; font-size: 12px; color: #64748b;">
          ${safeRole ? `<span style="background: #f1f5f9; padding: 2px 8px; border-radius: 4px;">${safeRole}</span>` : ""}
          <span style="font-weight: 500; color: #334155;">${safeSpeaker}</span>
        </div>
        <div style="max-width: 90%; background: ${bgColor}; color: ${textColor}; padding: 16px; border-radius: 16px; box-shadow: 0 1px 2px rgba(0,0,0,0.05);">
          <p style="margin: 0; font-size: 14px; line-height: 1.6; white-space: pre-wrap;">${safeText}</p>
        </div>
      </div>`;
    });

    html += `</div>`;
  }

  // Full Transcript (collapsible)
  if (data.transcript) {
    const safeTranscript = escapeHtml(data.transcript);
    html += `<details style="margin-top: 24px; border: 1px solid #e2e8f0; border-radius: 8px; background: #fff;">
      <summary style="cursor: pointer; padding: 12px 16px; font-weight: 500; color: #334155;">
        ${language === "zh" ? "完整会议记录" : "Full Transcript"}
      </summary>
      <div style="padding: 16px; border-top: 1px solid #f1f5f9; max-height: 600px; overflow-y: auto;">
        <pre style="margin: 0; font-size: 14px; line-height: 1.6; white-space: pre-wrap; color: #1e293b; background: #f8fafc; padding: 16px; border-radius: 8px;">${safeTranscript}</pre>
      </div>
    </details>`;
  }

  html += `</div>`;
  return html;
}
