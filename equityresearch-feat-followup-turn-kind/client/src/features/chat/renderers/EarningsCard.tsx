import { SafeHtmlContent } from "@/components";
import { renderMarkdownToHtml } from "@/utils/renderMarkdown";
import type { UILanguage } from "@/utils/i18n";

/**
 * Frontend renderer for the EARNINGS card — structured replacement for the
 * 659-line server/agent/formatters/earnings.ts. The payload is a topic-/shape-
 * discriminated union (calendar range, nasdaq calendar, multi-quarter ask, ask,
 * transcript, transcript-QA, Q&A items, summary sections, plain text); this
 * dispatches the same way the formatter did. Chrome labels are localized via
 * uiLanguage; the LLM-generated narrative (answer / sections / responses) is
 * rendered in whatever language the backend produced it (unchanged from the old
 * card). Generic source_card channel (docs/CARD_RENDER_MIGRATION_PLAN.md).
 */
type Any = Record<string, any>;

const Markdown = ({ text }: { text: string }) => <SafeHtmlContent html={renderMarkdownToHtml(text)} className="leading-relaxed" />;

export const EarningsCard = ({ payload, uiLanguage }: { payload: unknown; uiLanguage: UILanguage }) => {
  const isZh = uiLanguage === "zh";
  const data = (payload ?? {}) as Any;

  if (data.topic === "calendar" && data.range && Array.isArray(data.days)) return <RangeCalendar data={data} isZh={isZh} />;
  if (data.topic === "calendar" && data.calendar) return <NasdaqCalendar data={data} isZh={isZh} />;
  if (data.topic === "multi_quarter_ask") return <MultiQuarter data={data} isZh={isZh} />;
  if (data.topic === "ask") return <AskCard data={data} isZh={isZh} />;

  const ed: any = data.data || data;
  const ticker = data.ticker || ed?.ticker || "N/A";
  const year = data.year || ed?.year || "";
  const quarter = data.quarter || ed?.quarter || "";

  if (ed.transcript_split || ed.transcriptSplit || ed.transcript || ed.participants)
    return <Transcript data={ed} ticker={ticker} year={year} quarter={quarter} isZh={isZh} />;
  if (typeof ed.answer === "string" && (Array.isArray(ed.citations) || Array.isArray(ed.highlightPhrases) || typeof ed.hasAnswer === "boolean"))
    return <TranscriptQA data={ed} ticker={ticker} year={year} quarter={quarter} isZh={isZh} />;
  if (Array.isArray(ed.items)) return <QA data={ed} ticker={ticker} year={year} quarter={quarter} isZh={isZh} />;

  const sections = Array.isArray(ed) ? ed : ed?.sections;
  if (Array.isArray(sections) && sections.length > 0 && sections[0]?.heading)
    return <Summary sections={sections} ticker={ticker} periodLabel={year && quarter ? `${year} Q${quarter}` : ""} isZh={isZh} />;

  if (typeof data.response === "string") return <Markdown text={data.response} />;
  if (typeof ed === "string" && ed.length > 0)
    return (
      <Card>
        <div className="font-bold text-gray-800">📞 {isZh ? "财报分析" : "Earnings Analysis"} - {ticker}</div>
        <div className="mt-2"><Markdown text={ed} /></div>
      </Card>
    );

  return <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">📞 {isZh ? "暂无财报数据" : "No earnings data available"}</div>;
};

// ── shared chrome ──
const Card = ({ children }: { children: React.ReactNode }) => (
  <div className="overflow-hidden rounded-xl border border-gray-200 bg-white p-[18px] shadow-sm">{children}</div>
);
const PanelHeader = ({ title, sub, extra }: { title: string; sub?: string; extra?: string }) => (
  <div className="border-b border-gray-200 bg-gray-50 px-5 py-4">
    <div className="text-lg font-semibold text-gray-800">{title}</div>
    {sub && <div className="mt-1 text-[13px] text-gray-500">{sub}</div>}
    {extra && <div className="mt-0.5 text-[11px] text-gray-400">{extra}</div>}
  </div>
);
const Details = ({ summary, children, open }: { summary: string; children: React.ReactNode; open?: boolean }) => (
  <details open={open} className="mt-2">
    <summary className="cursor-pointer text-xs font-bold text-gray-500">{summary}</summary>
    <div className="mt-1.5">{children}</div>
  </details>
);

// ── ask ──
const SOURCE_PILL: Record<string, { en: string; zh: string; cls: string }> = {
  calendar: { en: "Earnings Calendar", zh: "财报日历", cls: "bg-emerald-50 text-emerald-700 border-emerald-200" },
  web: { en: "Web / RAG", zh: "网络/RAG", cls: "bg-blue-50 text-blue-700 border-blue-200" },
  transcript: { en: "Transcript", zh: "财报电话", cls: "bg-gray-100 text-gray-700 border-gray-200" },
  error: { en: "Service Error", zh: "服务异常", cls: "bg-red-50 text-red-700 border-red-200" },
};
const AskCard = ({ data, isZh }: { data: Any; isZh: boolean }) => {
  const ticker = typeof data.ticker === "string" ? data.ticker : "";
  const year = data.year ?? "";
  const quarter = typeof data.quarter === "string" ? data.quarter : typeof data.quarter === "number" ? `Q${data.quarter}` : "";
  const period = year && quarter ? `${quarter} ${year}` : year ? `${year}` : quarter;
  const answer = typeof data.answer === "string" && data.answer.trim() ? data.answer : isZh ? "未获取到有效回答。" : "No answer available.";
  const hasAnswer = data.hasAnswer !== false && answer.trim().length > 0;
  const references: string[] = Array.isArray(data.references) ? data.references.filter((r: any) => typeof r === "string" && r.trim()) : [];
  const citations: any[] = Array.isArray(data.citations) ? data.citations : [];
  const thinking = typeof data.thinking === "string" ? data.thinking.trim() : "";
  const pill = SOURCE_PILL[data.source as string] || { en: "Ask Checkit", zh: "智能问答", cls: "bg-gray-100 text-gray-700 border-gray-200" };

  return (
    <Card>
      <div className="mb-1.5 flex items-center gap-2">
        <div className="text-lg font-bold text-gray-900">📞 {isZh ? "财报问答" : "Earnings Q&A"}</div>
        <span className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold ${pill.cls}`}>{isZh ? pill.zh : pill.en}</span>
      </div>
      {(ticker || period) && <div className="mb-3.5 text-[13px] text-gray-500">{ticker}{period ? ` · ${period}` : ""}</div>}
      <AnswerBlock answer={answer} hasAnswer={hasAnswer} isZh={isZh} />
      {!hasAnswer && <div className="mb-3 text-xs text-amber-800">{isZh ? "未能在财报数据中找到该问题的明确答案。" : "Could not find an explicit answer in the earnings data."}</div>}
      {references.length > 0 && (
        <Details summary={`${isZh ? "参考" : "References"} (${Math.min(references.length, 5)})`}>
          <div className="flex flex-col gap-1.5">
            {references.slice(0, 5).map((r, i) => <div key={i} className="rounded-md border border-gray-200 bg-slate-50 px-2.5 py-2 text-[13px] text-gray-800">{r}</div>)}
          </div>
        </Details>
      )}
      <CitationsDetails citations={citations} isZh={isZh} />
      {thinking && (
        <Details summary={isZh ? "推理过程" : "Thinking"}>
          <div className="whitespace-pre-wrap rounded-md border border-gray-200 bg-slate-50 px-2.5 py-2.5 text-xs leading-relaxed text-gray-600">{thinking}</div>
        </Details>
      )}
    </Card>
  );
};

const AnswerBlock = ({ answer, hasAnswer, isZh }: { answer: string; hasAnswer: boolean; isZh: boolean }) => (
  <div className={`mb-3 rounded-lg border px-3 py-3 ${hasAnswer ? "border-blue-200 bg-blue-50" : "border-amber-200 bg-amber-50"}`}>
    <div className={`mb-1.5 text-xs font-bold ${hasAnswer ? "text-blue-700" : "text-amber-700"}`}>{isZh ? "回答" : "Answer"}</div>
    <div className="text-sm text-gray-800"><Markdown text={answer} /></div>
  </div>
);

const CitationsDetails = ({ citations, isZh }: { citations: any[]; isZh: boolean }) => {
  const shown = citations.slice(0, 5).map((c, i) => ({ id: c?.id ?? i + 1, quote: typeof c?.quote === "string" ? c.quote : typeof c === "string" ? c : "" })).filter((c) => c.quote);
  if (shown.length === 0) return null;
  return (
    <Details summary={`${isZh ? "引用" : "Citations"} (${shown.length})`}>
      <div className="flex flex-col gap-1.5">
        {shown.map((c) => (
          <div key={c.id} className="rounded-md border border-gray-200 bg-slate-50 px-2.5 py-2">
            <div className="mb-0.5 text-[11px] font-semibold text-slate-600">[{c.id}]</div>
            <div className="text-[13px] leading-relaxed text-gray-800">{c.quote}</div>
          </div>
        ))}
      </div>
    </Details>
  );
};

// ── transcript QA ──
const TranscriptQA = ({ data, ticker, year, quarter, isZh }: { data: Any; ticker: string; year: any; quarter: any; isZh: boolean }) => {
  const answer = typeof data.answer === "string" && data.answer.trim() ? data.answer : isZh ? "会议记录中未获取到有效回答。" : "No answer available from transcript.";
  const hasAnswer = data.hasAnswer !== false;
  const highlights: string[] = Array.isArray(data.highlightPhrases) ? data.highlightPhrases : [];
  const citations: any[] = Array.isArray(data.citations) ? data.citations : [];
  const period = year && quarter ? `${year} Q${quarter}` : "";
  return (
    <Card>
      <div className="text-lg font-bold text-gray-900">📞 {isZh ? "财报电话会分析" : "Earnings Call Analysis"}</div>
      <div className="mb-3.5 text-[13px] text-gray-500">{ticker}{period ? ` - ${period}` : ""}</div>
      <AnswerBlock answer={answer} hasAnswer={hasAnswer} isZh={isZh} />
      {!hasAnswer && <div className="mb-3 text-xs text-amber-800">{isZh ? "该问题在当前会议记录中没有明确提及。" : "This transcript does not explicitly contain the requested information."}</div>}
      {highlights.length > 0 && (
        <div className="mb-3">
          <div className="mb-1.5 text-xs font-bold text-gray-500">{isZh ? "关键词" : "Highlights"}</div>
          <div className="flex flex-wrap gap-1.5">
            {highlights.slice(0, 6).map((p, i) => <span key={i} className="rounded-full border border-gray-200 bg-gray-100 px-2.5 py-1 text-xs text-gray-700">{String(p)}</span>)}
          </div>
        </div>
      )}
      {citations.length > 0 && (
        <div>
          <div className="mb-2 text-xs font-bold text-gray-500">{isZh ? "引用片段" : "Citations"}</div>
          <div className="flex flex-col gap-2">
            {citations.slice(0, 5).map((c, i) => {
              const id = c?.id || i + 1;
              const pos = typeof c?.position === "number" ? c.position : undefined;
              return (
                <div key={i} className="rounded-lg border border-gray-200 bg-slate-50 p-2.5">
                  <div className="mb-1 text-xs font-semibold text-slate-600">[{id}]{pos !== undefined ? ` · pos ${pos}` : ""}</div>
                  <div className="text-[13px] leading-relaxed text-gray-800">{typeof c?.quote === "string" ? c.quote : ""}</div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </Card>
  );
};

// ── multi-quarter ──
const MultiQuarter = ({ data, isZh }: { data: Any; isZh: boolean }) => {
  const quarters: any[] = Array.isArray(data.quarters) ? data.quarters : [];
  return (
    <div className="overflow-hidden rounded-xl bg-white shadow-sm">
      <div className="bg-gradient-to-br from-indigo-600 to-purple-600 px-[18px] py-3.5 text-white">
        <div className="text-[15px] font-bold">📊 {isZh ? "多季度财报数据" : "Multi-Quarter Earnings"} — {data.ticker || "N/A"}</div>
        {data.question && <div className="mt-1 text-[11px] opacity-80">{String(data.question).slice(0, 120)}</div>}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-[13px]">
          <thead>
            <tr className="border-b-2 border-slate-200 bg-slate-50 text-[11px] uppercase tracking-wide text-gray-500">
              <th className="px-3.5 py-2.5 text-left">{isZh ? "季度" : "Quarter"}</th>
              <th className="px-3.5 py-2.5 text-left">{isZh ? "答复" : "Answer"}</th>
            </tr>
          </thead>
          <tbody>
            {quarters.map((q, i) => (
              <tr key={i} className="border-b border-gray-200">
                <td className="whitespace-nowrap px-3.5 py-2.5 align-top font-semibold text-indigo-600">{q.quarter}{data.year ? ` ${q.year ?? data.year}` : ""}</td>
                <td className="px-3.5 py-2.5 leading-relaxed text-gray-700">{q.hasAnswer && q.answer ? String(q.answer) : <span className="text-gray-400">{isZh ? "暂无数据" : "No data available"}</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

// ── summary ──
const Summary = ({ sections, ticker, periodLabel, isZh }: { sections: any[]; ticker: string; periodLabel: string; isZh: boolean }) => (
  <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
    <PanelHeader title={`📞 ${isZh ? "财报摘要" : "Earnings Summary"}`} sub={`${ticker}${periodLabel ? ` - ${periodLabel}` : ""}`} />
    <div className="p-3">
      {sections.map((section, idx) => {
        const isRedFlag = /red flag|风险提示/i.test(section.heading || "");
        return (
          <details key={idx} open={idx === 0} className="mb-2">
            <summary className={`cursor-pointer rounded-lg border px-4 py-3 text-sm font-semibold ${isRedFlag ? "border-red-200 bg-red-50 text-red-600" : "border-gray-200 bg-gray-100 text-gray-700"}`}>
              {section.heading}
            </summary>
            <div className={`mt-1 rounded-lg border p-4 ${isRedFlag ? "border-red-200 bg-red-50" : "border-gray-200 bg-white"}`}>
              {(section.bullets || []).map((b: string, i: number) => (
                <div key={i} className={`mb-3 flex items-start gap-2.5 text-sm leading-relaxed ${isRedFlag ? "text-red-800" : "text-gray-700"}`}>
                  <span className={isRedFlag ? "text-red-600" : "text-blue-600"}>•</span>
                  <span className="flex-1"><Markdown text={b} /></span>
                </div>
              ))}
            </div>
          </details>
        );
      })}
    </div>
  </div>
);

// ── Q&A items ──
const QA = ({ data, ticker, year, quarter, isZh }: { data: Any; ticker: string; year: any; quarter: any; isZh: boolean }) => {
  const items: any[] = Array.isArray(data.items) ? data.items : [];
  const sentTone = (s: number) => (s >= 7 ? "bg-green-100 text-green-800" : s >= 6 ? "bg-blue-100 text-blue-800" : "bg-yellow-100 text-yellow-800");
  return (
    <div>
      {data.conclusion && (
        <div className="mb-5 rounded-lg border border-gray-200 bg-white p-5">
          <h3 className="mb-3 text-lg font-bold text-blue-800">{isZh ? "总体结论" : "Overall Conclusion"}</h3>
          <p className="text-sm leading-relaxed text-gray-700"><Markdown text={String(data.conclusion)} /></p>
        </div>
      )}
      <div className="rounded-lg border border-gray-200 bg-white p-5">
        <div className="mb-4 flex items-baseline gap-2">
          <span className="text-lg font-bold text-gray-900">{isZh ? "问答环节" : "Q&A Session"}</span>
          <span className="text-[15px] text-gray-900">{ticker} - {year} Q{quarter}</span>
          <span className="text-sm text-gray-400">({items.length} {isZh ? "个问题" : "questions"})</span>
        </div>
        <div className="flex flex-col gap-4">
          {items.slice(0, 10).map((item, idx) => {
            const sentiment = item.sentiment || 5;
            return (
              <div key={idx} className="overflow-hidden rounded-lg border border-gray-200">
                <div className="flex flex-wrap items-center gap-2 bg-gray-50 px-4 py-2.5">
                  <span className="rounded bg-gray-200 px-1.5 py-0.5 text-xs font-semibold text-gray-500">#{item.index || idx + 1}</span>
                  <span className="text-sm font-bold text-gray-900">{item.analyst || (isZh ? "未知分析师" : "Unknown Analyst")}</span>
                  <span className="text-[13px] text-gray-500">{item.firm || (isZh ? "未知机构" : "Unknown Firm")}</span>
                  <span className={`ml-auto rounded-full px-2.5 py-0.5 text-xs font-semibold ${sentTone(sentiment)}`}>{isZh ? "情绪" : "Sentiment"}: {sentiment}</span>
                </div>
                <div className="border-t border-gray-200 px-4 py-3.5">
                  <p className="mb-1.5 text-[13px] font-bold text-gray-700">{isZh ? "提问：" : "Question:"}</p>
                  <p className="text-sm leading-relaxed text-gray-800">{item.question}</p>
                </div>
                <div className="border-t border-gray-200 bg-gray-50/50 px-4 py-3.5">
                  <p className="mb-1.5 text-[13px] font-bold text-gray-700">{isZh ? "回答：" : "Response:"}</p>
                  <p className="text-sm leading-relaxed text-gray-700">{item.response}</p>
                </div>
              </div>
            );
          })}
          {items.length > 10 && <p className="text-center text-sm text-gray-500">{isZh ? `显示 ${items.length} 个问题中的前 10 个` : `Showing 10 of ${items.length} questions`}</p>}
        </div>
      </div>
    </div>
  );
};

// ── transcript ──
const Transcript = ({ data, ticker, year, quarter, isZh }: { data: Any; ticker: string; year: any; quarter: any; isZh: boolean }) => {
  const segments: any[] = data.transcript_split || data.transcriptSplit || [];
  const participants: any[] = Array.isArray(data.participants) ? data.participants : [];
  const meta = data.metadata || {};
  return (
    <div>
      <div className="mb-4">
        <h2 className="mb-1 text-2xl font-semibold text-slate-900">{meta.companyName || ticker} ({ticker})</h2>
        <p className="text-sm text-slate-500">
          {year} Q{quarter} {isZh ? "财报电话会议" : "Earnings Call"} · {meta.earningsTimingDisplay || (isZh ? "盘中" : "During Market")} · {meta.callDate || (isZh ? "日期待定" : "Date TBD")}
        </p>
      </div>
      {participants.length > 0 && (
        <details className="mb-4 rounded-lg border border-slate-200 bg-white">
          <summary className="cursor-pointer px-4 py-3 font-medium text-slate-700">{isZh ? "参会人员" : "Participants"} ({participants.length})</summary>
          <ul className="border-t border-slate-100 px-4 py-3">
            {participants.map((p, i) => (
              <li key={i} className="py-1 text-sm">
                <span className="text-blue-600">{p.name || "Unknown"}</span>
                {p.role && <span className="text-slate-500"> — {p.role}{p.company ? `, ${p.company}` : ""}</span>}
              </li>
            ))}
          </ul>
        </details>
      )}
      {segments.length > 0 && (
        <div className="flex flex-col gap-4">
          {segments.map((seg, i) => {
            const role = (seg.role || "").toLowerCase();
            const isAnalyst = /analyst|research|bank|capital|securities/.test(role);
            const isMgmt = /ceo|cfo|coo|cto|chief|president|vp|ir|operator|management|executive/.test(role);
            const tone = isAnalyst ? "bg-blue-50 text-blue-900" : isMgmt ? "bg-emerald-50 text-emerald-900" : "bg-slate-50 text-slate-800";
            return (
              <div key={i} className={`flex flex-col gap-1 ${isAnalyst ? "items-end" : "items-start"}`}>
                <div className="flex items-center gap-2 text-xs text-slate-500">
                  {seg.role && <span className="rounded bg-slate-100 px-2 py-0.5">{seg.role}</span>}
                  <span className="font-medium text-slate-700">{seg.speaker || seg.company || "Unknown"}</span>
                </div>
                <div className={`max-w-[90%] rounded-2xl p-4 shadow-sm ${tone}`}>
                  <p className="whitespace-pre-wrap text-sm leading-relaxed">{seg.text || ""}</p>
                </div>
              </div>
            );
          })}
        </div>
      )}
      {data.transcript && (
        <details className="mt-6 rounded-lg border border-slate-200 bg-white">
          <summary className="cursor-pointer px-4 py-3 font-medium text-slate-700">{isZh ? "完整会议记录" : "Full Transcript"}</summary>
          <div className="max-h-[600px] overflow-y-auto border-t border-slate-100 p-4">
            <pre className="whitespace-pre-wrap rounded-lg bg-slate-50 p-4 text-sm leading-relaxed text-slate-800">{data.transcript}</pre>
          </div>
        </details>
      )}
    </div>
  );
};

// ── calendars ──
const NasdaqCalendar = ({ data, isZh }: { data: Any; isZh: boolean }) => {
  const rows: any[] = Array.isArray(data.calendar?.rows) ? data.calendar.rows : [];
  const slice = rows.slice(0, 80);
  const cols = isZh ? ["代码", "公司", "时间", "财季结束", "实际EPS", "一致预期"] : ["Symbol", "Company", "Time", "FQ End", "EPS", "Est."];
  return (
    <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
      <PanelHeader
        title={`📅 ${isZh ? "美股财报发布日程" : "US Earnings Calendar"}`}
        sub={isZh ? `日期 ${data.date || ""} · Nasdaq · ${rows.length} 家` : `Date ${data.date || ""} · Nasdaq · ${rows.length} companies`}
        extra={`${data.calendar?.asOf ? `${isZh ? "数据截至" : "As of"} ${data.calendar.asOf} · ` : ""}${isZh ? "🇺🇸 美东时间 (ET)" : "🇺🇸 US Eastern (ET)"}`}
      />
      <div className="overflow-x-auto p-3">
        <table className="w-full border-collapse text-[13px]">
          <thead>
            <tr>{cols.map((c) => <th key={c} className="border-b border-gray-200 px-2.5 py-2 text-left text-xs text-gray-500">{c}</th>)}</tr>
          </thead>
          <tbody>
            {slice.length === 0 ? (
              <tr><td colSpan={6} className="px-4 py-4 text-gray-500">{isZh ? "该日暂无财报安排（或数据未返回）。" : "No earnings scheduled for this date (or empty response)."}</td></tr>
            ) : (
              slice.map((r, i) => (
                <tr key={i} className="border-b border-gray-100">
                  <td className="px-2.5 py-2 font-semibold">{r.symbol}</td>
                  <td className="px-2.5 py-2">{r.name}</td>
                  <td className="px-2.5 py-2 text-xs">{r.time}</td>
                  <td className="px-2.5 py-2 text-xs">{r.fiscalQuarterEnding}</td>
                  <td className="px-2.5 py-2">{r.eps}</td>
                  <td className="px-2.5 py-2">{r.epsForecast}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
        {rows.length > 80 && <p className="mt-2.5 text-xs text-gray-500">{isZh ? `仅显示前 80 条，共 ${rows.length} 条。` : `Showing first 80 of ${rows.length} rows.`}</p>}
      </div>
    </div>
  );
};

const RangeCalendar = ({ data, isZh }: { data: Any; isZh: boolean }) => {
  const range = data.range || {};
  const days: any[] = Array.isArray(data.days) ? data.days : [];
  const total = Number(data.totalCompanies || 0);
  const shown = Number(data.shownCompanies || 0);
  const timing = (tm: string) => {
    const s = (tm || "").toLowerCase();
    if (s.includes("pre")) return isZh ? "盘前" : "AM";
    if (s.includes("post")) return isZh ? "盘后" : "PM";
    return "";
  };
  return (
    <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
      <PanelHeader
        title={`📅 ${isZh ? "财报日历" : "Earnings Calendar"}${range.label ? ` — ${range.label}` : ""}`}
        sub={isZh ? `${range.start} 至 ${range.end} · 共 ${total} 家` : `${range.start} → ${range.end} · ${total} companies`}
        extra={isZh ? "🇺🇸 日期为美东时间 (ET)" : "🇺🇸 Dates in US Eastern (ET)"}
      />
      <div className="px-4 py-3">
        {days.length === 0 ? (
          <div className="px-2 py-2 text-gray-500">{isZh ? "该区间暂无财报安排。" : "No earnings scheduled in this range."}</div>
        ) : (
          days.map((d, i) => (
            <div key={i} className="my-2.5">
              <div className="mb-1 text-[13px] font-semibold text-gray-700">{d.date} · {d.companies?.length || 0}</div>
              <div>
                {(d.companies || []).map((c: any, j: number) => (
                  <span key={j} className="m-0.5 inline-block rounded-md bg-gray-100 px-2 py-0.5 text-xs text-gray-700">
                    {c.symbol}{timing(c.time) ? <span className="text-gray-400"> {timing(c.time)}</span> : null}
                  </span>
                ))}
              </div>
            </div>
          ))
        )}
        {total > shown && <p className="mt-2.5 text-xs text-gray-500">{isZh ? `仅显示前 ${shown} 家，共 ${total} 家。` : `Showing first ${shown} of ${total} companies.`}</p>}
      </div>
    </div>
  );
};
