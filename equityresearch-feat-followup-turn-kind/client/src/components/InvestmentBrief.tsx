import React from "react";
import { SafeHtmlContent } from "./SafeHtmlContent";
import type { ResearchData, BriefSourceRef } from "./ResearchOutput";

type UILang = "en" | "zh";

const COMPANY_LABEL: Record<string, string> = {
  NVDA: "NVIDIA",
  AAPL: "Apple",
  MSFT: "Microsoft",
  GOOGL: "Alphabet",
  GOOG: "Alphabet",
  AMZN: "Amazon",
  META: "Meta",
  TSLA: "Tesla",
  AMD: "AMD",
  INTC: "Intel",
  AVGO: "Broadcom",
  QCOM: "Qualcomm",
  COST: "Costco",
  JPM: "JPMorgan Chase",
  XOM: "Exxon Mobil",
};

const LABELS: Record<
  UILang,
  {
    brief: string;
    event: string;
    executiveSummary: string;
    verdict: string;
    whatDrove: string;
    financial: string;
    metric: string;
    value: string;
    yoy: string;
    keyTakeaway: string;
    valuation: string;
    evidence: string;
    bull: string;
    bear: string;
    final: string;
    horizon: string;
    conviction: string;
    sources: string;
    otherSources: string;
  }
> = {
  en: {
    brief: "Investment Brief",
    event: "Event",
    executiveSummary: "Executive Summary",
    verdict: "Verdict",
    whatDrove: "What Drove the Jump?",
    financial: "The Financial Foundation (Earnings & Data)",
    metric: "Metric",
    value: "Value",
    yoy: "YoY / note",
    keyTakeaway: "Key takeaway",
    valuation: "Valuation – Expensive but Defensible",
    evidence: "Evidence Summary",
    bull: "Bull Case (Stronger)",
    bear: "Bear Case (Weaker, but real)",
    final: "Final Investment Decision",
    horizon: "Time horizon",
    conviction: "Conviction",
    sources: "Sources",
    otherSources: "Other sources",
  },
  zh: {
    brief: "投资简报",
    event: "事件",
    executiveSummary: "执行摘要",
    verdict: "结论",
    whatDrove: "上涨驱动因素",
    financial: "财务与数据基础",
    metric: "指标",
    value: "数值",
    yoy: "同比 / 备注",
    keyTakeaway: "要点",
    valuation: "估值 — 偏贵但可解释",
    evidence: "证据摘要",
    bull: "多头论据（更强）",
    bear: "空头论据（仍须重视）",
    final: "最终投资判断",
    horizon: "投资期限",
    conviction: "确信度",
    sources: "来源",
    otherSources: "其他来源",
  },
};

function norm(s: string): string {
  return s.toLowerCase().replace(/\s+/g, "");
}

function findModule(
  modules: ResearchData["modules"],
  patterns: string[],
): ResearchData["modules"][0] | undefined {
  for (const m of modules) {
    const name = norm(m.module || "");
    if (patterns.some((p) => name.includes(norm(p)))) return m;
  }
  return undefined;
}

function displayCompany(ticker: string): string {
  const t = ticker.trim().toUpperCase();
  return COMPANY_LABEL[t] || t;
}

/** LLMs often append pseudo-JSON tail blocks to narrative HTML — strip before render. */
function stripTrailingJsonKeyNoise(html: string): string {
  if (!html || typeof html !== "string") return html;
  let s = html;
  const tailNoise: RegExp[] = [
    /\s*evidence_graph\s*:\s*[\s\S]*$/i,
    /\s*Analysis_Decision\s*:\s*[\s\S]*$/i,
    /\s*analysis_decision\s*:\s*[\s\S]*$/i,
    /\s*investment_decision\s*:\s*[\s\S]*$/i,
    /\s*key_insights\s*:\s*[\s\S]*$/i,
    /\s*suggested_followups\s*:\s*[\s\S]*$/i,
    /\s*modules\s*:\s*[\s\S]*$/i,
  ];
  for (const re of tailNoise) {
    s = s.replace(re, "");
  }
  return s.trim();
}

function moduleHasFinancialContent(
  m: ResearchData["modules"][0] | undefined,
): boolean {
  if (!m) return false;
  const steps = (m.reasoning_steps || []).filter((s) => String(s).trim()).length;
  return steps > 0 || Boolean(String(m.conclusion ?? "").trim());
}

function isPlaceholderMetricValue(v: unknown): boolean {
  if (v == null) return true;
  const t = String(v).trim();
  if (!t) return true;
  return /^(n\/?a|—|-|none|unknown)$/i.test(t);
}

function buildEventLine(
  data: ResearchData,
  lang: UILang,
): string | null {
  const km = data.evidence_graph?.key_metrics || {};
  const id = data.investment_decision;
  const price =
    km["Current Price"] ||
    km["current_price"] ||
    km["Price"] ||
    id?.current_price;
  const high = km["52-Week High/Low"] || km["52WeekHigh/Low"];
  const jump = km["Daily Change"] || km["Move"] || km["Intraday move"];
  const parts: string[] = [];
  if (jump && !isPlaceholderMetricValue(jump)) parts.push(String(jump));
  if (price && !isPlaceholderMetricValue(price)) parts.push(String(price));
  if (high && !isPlaceholderMetricValue(high)) parts.push(String(high));
  const news = findModule(data.modules, ["news", "新闻"]);
  if (parts.length === 0 && news?.reasoning_steps?.[0]) {
    const t = news.reasoning_steps[0].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    return t.length > 180 ? `${t.slice(0, 180)}…` : t;
  }
  if (parts.length === 0) return null;
  return lang === "zh" ? parts.join(" · ") : parts.join(" — ");
}

function verdictEmoji(verdict: string): string {
  const v = verdict.toUpperCase();
  if (v.includes("BUY") && !v.includes("SELL")) return "✅";
  if (v.includes("SELL") || v.includes("AVOID")) return "⚠️";
  return "➖";
}

function formatVerdictLine(data: ResearchData, lang: UILang): string {
  const id = data.investment_decision;
  const emoji = verdictEmoji(id.verdict);
  const horizon = id.time_horizon || "—";
  const conv = id.conviction || "—";
  if (lang === "zh") {
    return `${emoji} ${id.verdict}（${horizon}）— ${conv} 确信度`;
  }
  return `${emoji} ${id.verdict} (${horizon}) – ${conv} Conviction`;
}

/** "STOCK_PRICE" → "Stock Price" for non-linkable data-source chips. */
function prettyProvider(provider: string): string {
  return provider
    .split(/[_\s]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(" ");
}

/** Host fallback when a link source has no publisher. */
function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

/** Short ET date for "as of" — matches the calendar ET-anchoring convention. */
function formatAsOf(iso: string, language: UILang): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString(language === "zh" ? "zh-CN" : "en-US", {
    month: "short",
    day: "numeric",
    timeZone: "America/New_York",
  });
}

/**
 * Reusable verifiable-source chip row + inline card expansion. `link` sources are
 * clickable anchors; `model`/`data` sources are chips that expand their drill-down
 * card (when one exists). Self-contained open/collapse state, so it can be dropped
 * under each narrative section as well as the top-level footer.
 */
function SourceChips({
  sources,
  cards,
  language,
}: {
  sources: BriefSourceRef[];
  cards?: Record<string, string>;
  language: UILang;
}) {
  const [openId, setOpenId] = React.useState<string | null>(null);
  if (sources.length === 0) return null;
  const asOfWord = language === "zh" ? "截至" : "as of";
  const openCard = openId && cards ? cards[openId] : undefined;
  return (
    <div>
      <div className="flex flex-wrap gap-2">
        {sources.map((s, i) => {
          if (s.type === "link") {
            return (
              <a
                key={i}
                href={s.url}
                target="_blank"
                rel="noopener noreferrer"
                title={s.url}
                className="inline-flex items-center gap-1 rounded-full border border-blue-200 bg-blue-50 px-3 py-1.5 text-xs text-blue-700 hover:border-blue-300 hover:bg-blue-100"
              >
                📰 {s.publisher || hostOf(s.url)} ↗
              </a>
            );
          }
          const asOf = formatAsOf(s.asOf, language);
          const tail = asOf ? ` · ${asOfWord} ${asOf}` : "";
          const hasCard = Boolean(cards && cards[s.id]);
          const isOpen = openId === s.id;
          const body =
            s.type === "model" ? (
              <>
                🧮 {s.engine}
                {s.method ? ` · ${s.method}` : ""}
                {s.ticker ? ` (${s.ticker})` : ""}
                {tail}
              </>
            ) : (
              <>
                {prettyProvider(s.provider)}
                {s.ticker ? ` (${s.ticker})` : ""}
                {tail}
              </>
            );
          const tint =
            s.type === "model"
              ? "border-indigo-200 bg-indigo-50 text-indigo-700"
              : "border-gray-200 bg-gray-50 text-gray-600";
          // No card → static chip; otherwise a toggle button that expands the card.
          if (!hasCard) {
            return (
              <span key={i} className={`inline-flex items-center gap-1 rounded-full border px-3 py-1.5 text-xs ${tint}`}>
                {body}
              </span>
            );
          }
          return (
            <button
              key={i}
              type="button"
              onClick={() => setOpenId(isOpen ? null : s.id)}
              aria-expanded={isOpen}
              className={`inline-flex items-center gap-1 rounded-full border px-3 py-1.5 text-xs hover:brightness-95 ${tint}`}
            >
              {body}
              <span className="ml-0.5">{isOpen ? "▴" : "▾"}</span>
            </button>
          );
        })}
      </div>
      {openCard && (
        <div className="mt-3 rounded-lg border border-gray-200 overflow-x-auto">
          <SafeHtmlContent html={openCard} />
        </div>
      )}
    </div>
  );
}

/** A muted inline "Sources:" chip row attached under a narrative section. */
function SectionSources({
  sources,
  cards,
  language,
}: {
  sources: BriefSourceRef[];
  cards?: Record<string, string>;
  language: UILang;
}) {
  if (sources.length === 0) return null;
  return (
    <div className="mt-3">
      <span className="text-[11px] font-semibold uppercase tracking-wider text-gray-400">
        {language === "zh" ? "来源" : "Sources"}
      </span>
      <div className="mt-1">
        <SourceChips sources={sources} cards={cards} language={language} />
      </div>
    </div>
  );
}

/** Numbered citation list for the unified answer. Each entry's `id` anchors the
 *  inline [n] superscript in the body (href="#{anchorPrefix}-{citation.id}"). */
export function CitationsFooter({
  citations,
  cards,
  anchorPrefix,
  label,
  language,
}: {
  citations: import("@/types").BriefCitation[];
  cards?: Record<string, string>;
  anchorPrefix: string;
  label: string;
  language: UILang;
}) {
  if (citations.length === 0) return null;
  return (
    <section>
      <h2 className="text-base font-bold text-gray-900 mb-2 border-l-4 border-indigo-600 pl-2">
        {label}
      </h2>
      <ol className="space-y-2">
        {citations.map((c) => {
          // Link-backed citations (e.g. NEWS) → a real article list (title + domain +
          // open), mirroring the single-intent news card. Others → chip + drill-down card.
          const isLinkList = c.sources.length > 0 && c.sources.every((s) => s.type === "link");
          return (
            <li key={c.id} id={`${anchorPrefix}-${c.id}`} className="flex gap-2 scroll-mt-20">
              <span className="text-xs font-semibold text-gray-400 pt-1.5">[{c.n}]</span>
              <div className="min-w-0 flex-1">
                <div className="text-[11px] font-semibold uppercase tracking-wider text-gray-400 mb-1">{c.label}</div>
                {isLinkList ? (
                  <ul className="space-y-1">
                    {c.sources.map((s, i) =>
                      s.type === "link" ? (
                        <li key={i} className="flex items-baseline justify-between gap-2 text-xs">
                          <a
                            href={s.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            title={s.url}
                            className="min-w-0 truncate text-blue-700 hover:underline"
                          >
                            {s.title || hostOf(s.url)}
                          </a>
                          <span className="shrink-0 text-[11px] text-gray-400">
                            {hostOf(s.url)} ↗
                          </span>
                        </li>
                      ) : null,
                    )}
                  </ul>
                ) : (
                  <SourceChips sources={c.sources} cards={cards} language={language} />
                )}
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

/** Top-level footer for sources not already attributed to a narrative section.
 *  Exported for reuse by the unified-answer renderer (home.tsx). */
export function SourcesFooter({
  sources,
  cards,
  label,
  language,
}: {
  sources: BriefSourceRef[];
  cards?: Record<string, string>;
  label: string;
  language: UILang;
}) {
  if (sources.length === 0) return null;
  return (
    <section>
      <h2 className="text-base font-bold text-gray-900 mb-2 border-l-4 border-indigo-600 pl-2">
        {label}
      </h2>
      <SourceChips sources={sources} cards={cards} language={language} />
    </section>
  );
}

export interface InvestmentBriefProps {
  data: ResearchData;
  language?: UILang;
}

/**
 * Narrative “Investment Brief” layout for structured research JSON (replaces card dashboard).
 */
export const InvestmentBrief: React.FC<InvestmentBriefProps> = ({
  data,
  language = "en",
}) => {
  const L = LABELS[language];
  const qu = data.query_understanding;
  const ticker = (qu.tickers?.[0] || "—").toUpperCase();
  const company = displayCompany(ticker);
  const id = data.investment_decision;
  const eg = data.evidence_graph;
  const news = findModule(data.modules, ["news", "新闻"]);
  const earnings = findModule(data.modules, ["earning", "盈利"]);
  const dataAnalyst = findModule(data.modules, ["data analyst", "数据", "performance"]);
  const valuation = findModule(data.modules, ["valuation", "估值"]);

  const eventLine = buildEventLine(data, language);
  const keyInsights = Array.isArray((data as unknown as { key_insights?: unknown }).key_insights)
    ? ((data as unknown as { key_insights: string[] }).key_insights as string[])
    : [];
  const metricsEntriesRaw = eg?.key_metrics ? Object.entries(eg.key_metrics) : [];
  const metricsEntries = metricsEntriesRaw.filter(
    ([, v]) => String(v ?? "").trim().length > 0 && !isPlaceholderMetricValue(v),
  );

  const execBodyRaw = (id.summary && id.summary.trim()) ? id.summary : qu.reasoning || "";
  const execBody = stripTrailingJsonKeyNoise(execBodyRaw).trim() || "<p>—</p>";
  const finalBody = stripTrailingJsonKeyNoise(id.summary || "").trim();

  const hasFinancialBody =
    metricsEntries.length > 0 ||
    moduleHasFinancialContent(earnings) ||
    (dataAnalyst !== earnings && moduleHasFinancialContent(dataAnalyst)) ||
    Boolean(qu.reasoning?.trim() && metricsEntries.length > 0);

  // Per-section source attribution: each narrative section shows the chips for the
  // data it was built from; the footer mops up everything not claimed by a section.
  const allSources = Array.isArray(data.sources) ? data.sources : [];
  const cards = data.source_cards;
  const sourcesFor = (providers: string[]) =>
    allSources.filter((s) => providers.includes(s.provider));
  const showNewsSection = Boolean(news && (news.reasoning_steps?.length || news.conclusion));
  const showValuationSection = Boolean(valuation);
  const claimed = new Set<string>();
  if (showNewsSection) claimed.add("NEWS");
  if (hasFinancialBody) { claimed.add("EARNINGS"); claimed.add("PERFORMANCE"); }
  if (showValuationSection) claimed.add("VALUATION");
  const footerSources = allSources.filter((s) => !claimed.has(s.provider));

  return (
    <article className="investment-brief max-w-none text-sm text-gray-900 leading-relaxed space-y-6 w-full">
      <header className="border-b border-gray-200 pb-4">
        <h1 className="text-lg sm:text-xl font-bold text-gray-900 tracking-tight">
          {company} ({ticker}) {L.brief}
        </h1>
        {eventLine && (
          <p className="mt-2 text-sm font-semibold text-indigo-800">
            <span className="text-gray-500 font-medium">{L.event}: </span>
            {eventLine}
          </p>
        )}
      </header>

      <section>
        <h2 className="text-base font-bold text-gray-900 mb-2 border-l-4 border-indigo-600 pl-2">
          {L.executiveSummary}
        </h2>
        <div className="text-gray-800 space-y-2">
          <SafeHtmlContent html={execBody} className="leading-relaxed" />
        </div>
        <p className="mt-3 text-sm font-semibold text-gray-900">{L.verdict}: {formatVerdictLine(data, language)}</p>
      </section>

      {news && (news.reasoning_steps?.length > 0 || news.conclusion) && (
        <section>
          <h2 className="text-base font-bold text-gray-900 mb-2 border-l-4 border-indigo-600 pl-2">
            {L.whatDrove}
          </h2>
          <ul className="list-disc pl-5 space-y-2 text-gray-800">
            {(news.reasoning_steps || []).map((step, i) => (
              <li key={i} className="leading-relaxed">
                <SafeHtmlContent html={stripTrailingJsonKeyNoise(step)} />
              </li>
            ))}
          </ul>
          {news.conclusion && (
            <blockquote className="mt-3 pl-3 border-l-2 border-gray-300 text-gray-600 italic text-sm">
              <SafeHtmlContent html={stripTrailingJsonKeyNoise(news.conclusion)} />
            </blockquote>
          )}
          <SectionSources sources={sourcesFor(["NEWS"])} cards={cards} language={language} />
        </section>
      )}

      {hasFinancialBody ? (
      <section>
        <h2 className="text-base font-bold text-gray-900 mb-2 border-l-4 border-indigo-600 pl-2">
          {L.financial}
        </h2>
        {metricsEntries.length > 0 ? (
          <div className="overflow-x-auto rounded-lg border border-gray-200">
            <table className="min-w-full text-left text-xs sm:text-sm">
              <thead className="bg-gray-50 text-gray-600 uppercase tracking-wide">
                <tr>
                  <th className="px-3 py-2 font-semibold">{L.metric}</th>
                  <th className="px-3 py-2 font-semibold">{L.value}</th>
                  <th className="px-3 py-2 font-semibold">{L.yoy}</th>
                </tr>
              </thead>
              <tbody>
                {metricsEntries.map(([k, v]) => (
                  <tr key={k} className="border-t border-gray-100 odd:bg-white even:bg-gray-50/80">
                    <td className="px-3 py-2 font-medium text-gray-800 whitespace-nowrap">{k}</td>
                    <td className="px-3 py-2 text-gray-900">
                      <SafeHtmlContent html={String(v)} />
                    </td>
                    <td className="px-3 py-2 text-gray-500">—</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
        {(earnings || dataAnalyst) && (
          <div className="mt-3 space-y-3 text-gray-800">
            {earnings && (
              <div>
                <p className="text-xs font-semibold text-gray-500 mb-1">{earnings.module}</p>
                <ul className="list-disc pl-5 space-y-1">
                  {(earnings.reasoning_steps || []).map((s, i) => (
                    <li key={i}>
                      <SafeHtmlContent html={s} />
                    </li>
                  ))}
                </ul>
                {earnings.conclusion && (
                  <p className="mt-2 text-gray-700">
                    <SafeHtmlContent html={stripTrailingJsonKeyNoise(earnings.conclusion)} />
                  </p>
                )}
              </div>
            )}
            {dataAnalyst && dataAnalyst !== earnings && (
              <div>
                <p className="text-xs font-semibold text-gray-500 mb-1">{dataAnalyst.module}</p>
                <ul className="list-disc pl-5 space-y-1">
                  {(dataAnalyst.reasoning_steps || []).map((s, i) => (
                    <li key={i}>
                      <SafeHtmlContent html={s} />
                    </li>
                  ))}
                </ul>
                {dataAnalyst.conclusion && (
                  <p className="mt-2 text-gray-700">
                    <SafeHtmlContent html={stripTrailingJsonKeyNoise(dataAnalyst.conclusion)} />
                  </p>
                )}
              </div>
            )}
          </div>
        )}
        {qu.reasoning && metricsEntries.length > 0 && (
          <p className="mt-3 text-sm">
            <span className="font-semibold text-gray-800">{L.keyTakeaway}: </span>
            <span className="text-gray-700">{qu.reasoning}</span>
          </p>
        )}
        <SectionSources sources={sourcesFor(["EARNINGS", "PERFORMANCE"])} cards={cards} language={language} />
      </section>
      ) : null}

      {valuation && (
        <section>
          <h2 className="text-base font-bold text-gray-900 mb-2 border-l-4 border-indigo-600 pl-2">
            {L.valuation}
          </h2>
          <ul className="list-disc pl-5 space-y-2 text-gray-800">
            {(valuation.reasoning_steps || []).map((s, i) => (
              <li key={i}>
                <SafeHtmlContent html={s} />
              </li>
            ))}
          </ul>
          {valuation.conclusion && (
            <p className="mt-2 text-gray-800">
              <SafeHtmlContent html={stripTrailingJsonKeyNoise(valuation.conclusion)} />
            </p>
          )}
          <SectionSources sources={sourcesFor(["VALUATION"])} cards={cards} language={language} />
        </section>
      )}

      {keyInsights.length > 0 && (
        <section>
          <h2 className="text-base font-bold text-gray-900 mb-2 border-l-4 border-indigo-600 pl-2">
            {language === "zh" ? "核心洞察" : "Key insights"}
          </h2>
          <ul className="list-disc pl-5 space-y-1 text-gray-800">
            {keyInsights.map((t, i) => (
              <li key={i}>
                <SafeHtmlContent html={stripTrailingJsonKeyNoise(t)} />
              </li>
            ))}
          </ul>
        </section>
      )}

      {eg && (eg.bull_case?.length || eg.bear_case?.length) ? (
        <section className="space-y-4">
          <h2 className="text-base font-bold text-gray-900 mb-2 border-l-4 border-indigo-600 pl-2">
            {L.evidence}
          </h2>
          {eg.bull_case && eg.bull_case.length > 0 && (
            <div>
              <h3 className="text-sm font-semibold text-gray-900 mb-2">
                ✅ {L.bull}
              </h3>
              <ul className="list-disc pl-5 space-y-1.5 text-gray-800 text-sm leading-relaxed">
                {eg.bull_case.map((pt, i) => (
                  <li key={i}>
                    <SafeHtmlContent html={stripTrailingJsonKeyNoise(pt)} />
                  </li>
                ))}
              </ul>
            </div>
          )}
          {eg.bear_case && eg.bear_case.length > 0 && (
            <div>
              <h3 className="text-sm font-semibold text-gray-900 mb-2">
                ⚠️ {L.bear}
              </h3>
              <ul className="list-disc pl-5 space-y-1.5 text-gray-800 text-sm leading-relaxed">
                {eg.bear_case.map((pt, i) => (
                  <li key={i}>
                    <SafeHtmlContent html={stripTrailingJsonKeyNoise(pt)} />
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>
      ) : null}

      <section>
        <h2 className="text-base font-bold text-gray-900 mb-2 border-l-4 border-indigo-600 pl-2">
          {L.final}
        </h2>
        <p className="text-sm text-gray-700 mb-2">
          <span className="font-semibold">{L.horizon}:</span> {id.time_horizon || "—"}
          {" · "}
          <span className="font-semibold">{L.conviction}:</span> {id.conviction || "—"}
        </p>
        <div className="text-gray-800 space-y-2">
          <SafeHtmlContent
            html={finalBody || "<p>—</p>"}
            className="leading-relaxed"
          />
        </div>
      </section>

      {footerSources.length > 0 && (
        <SourcesFooter
          sources={footerSources}
          cards={cards}
          label={claimed.size > 0 ? L.otherSources : L.sources}
          language={language}
        />
      )}

      {id.risk_disclaimer && (
        <footer className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-950">
          🧠 {id.risk_disclaimer}
        </footer>
      )}
    </article>
  );
};

export default InvestmentBrief;
