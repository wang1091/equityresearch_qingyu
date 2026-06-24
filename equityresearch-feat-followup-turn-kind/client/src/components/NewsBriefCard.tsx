import React, { useState } from "react";
import { BarChart3, ChevronDown, ChevronRight, ExternalLink } from "lucide-react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { SafeHtmlContent } from "./SafeHtmlContent";
import { UI_TEXTS, type UILanguage } from "@/utils/i18n";
import type { NewsBriefData } from "@/types";

interface NewsBriefCardProps {
  language?: UILanguage;
  brief?: NewsBriefData;
  insights?: NewsBriefData["insights"];
  analyses?: NewsBriefData["analyses"];
}

type ActionableGroup = {
  key: string;
  label: string;
  colorClass: string;
  items: string[];
};

const hasText = (value: unknown): value is string =>
  typeof value === "string" && value.trim().length > 0;

const hasNewsItems = (
  items: NewsBriefData["newsItems"],
): items is NonNullable<NewsBriefData["newsItems"]> =>
  Array.isArray(items) && items.some((item) => hasText(item?.text));

const sourceLabel = (
  source: NonNullable<NonNullable<NewsBriefData["newsItems"]>[number]["sources"]>[number],
) => {
  if (hasText(source.publisher)) return source.publisher;
  if (hasText(source.title)) return source.title;
  try {
    return new URL(source.url).hostname.replace(/^www\./, "");
  } catch {
    return source.ref || "Source";
  }
};

// Only Historical Events and Comments remain in actionable groups
function buildActionableGroups(data: NewsBriefData, language: UILanguage): ActionableGroup[] {
  const zh = language === "zh";

  const groups: ActionableGroup[] = [
    {
      key: "historical",
      label: zh ? "🕐 历史事件" : "🕐 Historical Events",
      colorClass: "text-gray-700 border-gray-200 bg-gray-50",
      items: hasText(data.historicalInsight?.implication)
        ? [`${hasText(data.historicalInsight?.pattern) ? `[${data.historicalInsight.pattern}] ` : ""}${data.historicalInsight.implication}`]
        : [],
    },
    {
      key: "comments",
      label: zh ? "💬 评论" : "💬 Comments",
      colorClass: "text-indigo-700 border-indigo-200 bg-indigo-50",
      items: [
        hasText(data.bottomLine?.realityCheck) ? data.bottomLine.realityCheck : "",
        hasText(data.bottomLine?.valuationChange) ? data.bottomLine.valuationChange : "",
        hasText(data.bottomLine?.watchNext)
          ? `${zh ? "关注" : "Watch"}: ${data.bottomLine.watchNext}`
          : "",
      ].filter(hasText),
    },
  ];

  return groups.filter((group) => group.items.length > 0);
}

function renderNewsItems(items: NonNullable<NewsBriefData["newsItems"]>) {
  return (
    <div className="space-y-3">
      {items.map((item, index) => {
        if (!hasText(item.text)) return null;
        return (
          <div key={`${index}-${item.text.slice(0, 24)}`} className="rounded-lg border border-slate-200 bg-slate-50 p-3">
            <div className="flex gap-2 text-sm leading-relaxed text-gray-700">
              <span className="mt-0.5 shrink-0 opacity-60">•</span>
              <SafeHtmlContent html={item.text} className="text-sm leading-relaxed text-gray-700" />
            </div>
            {item.sources && item.sources.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-1.5 pl-5">
                {item.sources.map((source, sourceIndex) => (
                  <a
                    key={`${source.url}-${sourceIndex}`}
                    href={source.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex max-w-full items-center gap-1 rounded-full border border-slate-200 bg-white px-2 py-1 text-[11px] font-semibold text-slate-600 hover:border-blue-300 hover:text-blue-700"
                    title={source.title || source.url}
                  >
                    <span className="truncate">{sourceLabel(source)}</span>
                    <ExternalLink className="h-3 w-3 shrink-0" />
                  </a>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

export const NewsBriefCard: React.FC<NewsBriefCardProps> = ({
  language = "en",
  brief,
  insights,
  analyses,
}) => {
  const [isNewsExpanded, setIsNewsExpanded] = useState(false);
  const text = UI_TEXTS[language];
  const data: NewsBriefData = {
    ...(brief || {}),
    insights: brief?.insights ?? insights ?? [],
    analyses: brief?.analyses ?? analyses ?? [],
  };

  const groupedInsights = buildActionableGroups(data, language);
  const analysisItems = data.analyses.map((item) => item?.text).filter(hasText);
  const showNewsSection = hasNewsItems(data.newsItems);
  const priceAvailable = typeof data.currentPrice === "number" && Number.isFinite(data.currentPrice);
  const pricePrefix = hasText(data.currency) && data.currency !== "USD" ? `${data.currency} ` : "$";

  const showActionableSection = analysisItems.length > 0 || groupedInsights.length > 0 || data.insights.length > 0;

  return (
    <div className="mb-4 rounded-lg border border-blue-200 bg-gradient-to-br from-blue-50 to-indigo-50 p-3 shadow-sm">
      {/* Header */}
      <div className="mb-3 flex items-start justify-between gap-2">
        <h5 className="flex items-center gap-2 text-sm font-medium text-blue-900">
          📊 <span className="leading-tight">{language === "en" ? "Intelligent News Analysis" : "智能新闻分析"}</span>
        </h5>
        {data.date && <span className="shrink-0 text-xs text-blue-700">{data.date}</span>}
      </div>

      <div className="space-y-3">
        {/* Actionable Insights box — contains price, Analysis, Historical Events, Comments */}
        {showActionableSection && (
          <div className="rounded-lg border border-blue-200 bg-white p-3">
            <h4 className="mb-3 text-sm font-medium text-blue-900">
              {language === "en" ? "💡 Actionable Insights" : "💡 智能分析"}
            </h4>

            {/* Ticker price row */}
            {data.ticker && priceAvailable && (
              <div className="mb-3 flex items-center gap-2 rounded-lg border border-green-200 bg-green-50 px-3 py-2">
                <span className="text-base font-bold text-green-800">{data.ticker}</span>
                <span className="text-base font-bold text-green-700">
                  {pricePrefix}{Number(data.currentPrice).toFixed(2)}
                </span>
                <span className="text-xs text-green-500">{data.currency || "USD"}</span>
              </div>
            )}

            <div className="space-y-3">
              {/* Analysis — first, right below price */}
              {analysisItems.length > 0 && (
                <div className="rounded-lg border border-blue-100 bg-blue-50 p-2.5">
                  <p className="mb-1.5 flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-blue-700">
                    <BarChart3 className="h-3.5 w-3.5" />
                    {language === "en" ? "Analysis" : "分析"}
                  </p>
                  <ul className="space-y-1.5">
                    {analysisItems.map((item, index) => {
                      const match = item.match(/^\s*(\d+)[.)、]\s*([\s\S]*)$/);
                      const body = (match?.[2] ?? item).trim();
                      return (
                        <li key={`analysis-${index}`} className="flex gap-2 text-sm leading-snug text-gray-700">
                          <span className="mt-0.5 shrink-0 opacity-50">•</span>
                          <SafeHtmlContent html={body} className="min-w-0 flex-1 text-sm leading-snug text-gray-700" />
                        </li>
                      );
                    })}
                  </ul>
                </div>
              )}

              {/* Historical Events and Comments */}
              {groupedInsights.map((group) => (
                <div key={group.key} className={`rounded-lg border p-2.5 ${group.colorClass}`}>
                  <p className="mb-1.5 text-xs font-bold uppercase tracking-wide">{group.label}</p>
                  <ul className="space-y-1">
                    {group.items.map((item, index) => (
                      <li key={`${group.key}-${index}`} className="flex gap-2 text-sm leading-snug text-gray-700">
                        <span className="mt-0.5 shrink-0 opacity-50">•</span>
                        <SafeHtmlContent html={item} className="text-sm leading-snug text-gray-700" />
                      </li>
                    ))}
                  </ul>
                </div>
              ))}

              {/* Fallback if no structured data */}
              {analysisItems.length === 0 && groupedInsights.length === 0 && data.insights.length > 0 && (
                <div className="rounded-lg border border-blue-200 bg-blue-50 p-2.5 text-blue-700">
                  <p className="mb-1.5 text-xs font-bold uppercase tracking-wide">💡 Insights</p>
                  <ul className="space-y-1">
                    {data.insights.map((item, index) => hasText(item?.text) ? (
                      <li key={`ins-${index}`} className="flex gap-2 text-sm leading-snug text-gray-700">
                        <span className="mt-0.5 shrink-0 opacity-50">•</span>
                        <SafeHtmlContent html={item.text} className="text-sm leading-snug text-gray-700" />
                      </li>
                    ) : null)}
                  </ul>
                </div>
              )}
            </div>
          </div>
        )}

        {/* News — collapsible, at the bottom */}
        {showNewsSection && (
          <Collapsible open={isNewsExpanded} onOpenChange={setIsNewsExpanded} className="w-full">
            <CollapsibleTrigger className="w-full">
              <div className="rounded-lg border border-blue-200 bg-white p-3 transition-colors hover:bg-gray-50">
                <div className="flex items-center justify-between">
                  <h4 className="text-sm font-medium text-blue-900">
                    📰 {language === "en" ? "News" : "新闻"}
                  </h4>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-gray-500">
                      {isNewsExpanded
                        ? (language === "en" ? "Click to collapse" : "点击收起")
                        : (language === "en" ? "Click to expand" : "点击展开")}
                    </span>
                    {isNewsExpanded ? (
                      <ChevronDown className="h-4 w-4 text-blue-600" />
                    ) : (
                      <ChevronRight className="h-4 w-4 text-blue-600" />
                    )}
                  </div>
                </div>
              </div>
            </CollapsibleTrigger>
            <CollapsibleContent className="mt-2">
              <div className="rounded-lg border border-blue-200 bg-white p-3">
                {renderNewsItems(data.newsItems!)}
              </div>
            </CollapsibleContent>
          </Collapsible>
        )}

        <div className="border-t border-gray-200 pt-3 text-center">
          <p className="text-xs italic text-gray-500">{text.investmentRiskDisclaimer}</p>
        </div>
      </div>
    </div>
  );
};
