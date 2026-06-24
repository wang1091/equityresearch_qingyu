import type { Message, NewsV2Data, NewsBriefData } from "@/types";

const pushIfNonEmpty = (units: string[], value: unknown) => {
  if (typeof value !== "string") return;
  const trimmed = value.trim();
  if (trimmed) units.push(trimmed);
};

const collectNewsDataDisplayUnits = (data: NewsV2Data | undefined, units: string[]) => {
  if (!data) return;
  const content = data.content;
  if (content) {
    pushIfNonEmpty(units, content.summary);
    pushIfNonEmpty(units, content.title);
    pushIfNonEmpty(units, content.dek);
    if (Array.isArray(content.notes)) content.notes.forEach((n) => pushIfNonEmpty(units, n));
    if (Array.isArray(content.items)) {
      content.items.forEach((item) => {
        pushIfNonEmpty(units, item?.headline);
        pushIfNonEmpty(units, item?.summary);
      });
    }
    if (Array.isArray(content.sections)) {
      content.sections.forEach((section) => {
        pushIfNonEmpty(units, section?.heading);
        if (Array.isArray(section?.paragraphs)) section.paragraphs.forEach((p) => pushIfNonEmpty(units, p));
        if (Array.isArray(section?.bullets)) section.bullets.forEach((b) => pushIfNonEmpty(units, b));
      });
    }
  }
  if (Array.isArray(data.search_results)) {
    data.search_results.forEach((source) => {
      pushIfNonEmpty(units, source?.title);
      pushIfNonEmpty(units, source?.snippet);
    });
  }
};

const collectBriefDataDisplayUnits = (data: NewsBriefData | undefined, units: string[]) => {
  if (!data) return;
  if (Array.isArray(data.insights)) data.insights.forEach((entry) => pushIfNonEmpty(units, entry?.text));
  if (Array.isArray(data.analyses)) data.analyses.forEach((entry) => pushIfNonEmpty(units, entry?.text));
  if (Array.isArray(data.newsItems)) data.newsItems.forEach((item) => pushIfNonEmpty(units, item?.text));
  if (Array.isArray(data.keySignals)) data.keySignals.forEach((item) => pushIfNonEmpty(units, item));
  if (Array.isArray(data.whatMatters?.coreDrivers)) {
    data.whatMatters.coreDrivers.forEach((item) => pushIfNonEmpty(units, item));
  }
  pushIfNonEmpty(units, data.whatMatters?.whyItMatters);
  pushIfNonEmpty(units, data.expectationGap?.alreadyPricedIn);
  pushIfNonEmpty(units, data.expectationGap?.newInformation);
  pushIfNonEmpty(units, data.historicalInsight?.similarCase);
  pushIfNonEmpty(units, data.historicalInsight?.pattern);
  pushIfNonEmpty(units, data.historicalInsight?.implication);
  pushIfNonEmpty(units, data.valuationData?.verdict);
  pushIfNonEmpty(units, data.valuationData?.confidence);
  pushIfNonEmpty(units, data.valuationData?.recommendation);
  pushIfNonEmpty(units, data.valuationImpact?.driver);
  pushIfNonEmpty(units, data.valuationImpact?.duration);
  pushIfNonEmpty(units, data.valuationImpact?.summary);
  pushIfNonEmpty(units, data.bottomLine?.realityCheck);
  pushIfNonEmpty(units, data.bottomLine?.valuationChange);
  pushIfNonEmpty(units, data.bottomLine?.watchNext);
  pushIfNonEmpty(units, data.earningsSummary?.sentiment);
  pushIfNonEmpty(units, data.earningsSummary?.summary);
  if (Array.isArray(data.earningsSummary?.highlights)) {
    data.earningsSummary.highlights.forEach((item) => pushIfNonEmpty(units, item));
  }
};

/**
 * Pick the canonical source-language copy of each translatable field.
 * Falls back to the live field (which is the source until a translation runs).
 */
export const resolveSourceView = (message: Message): {
  content: string | undefined;
  newsData: NewsV2Data | undefined;
  briefData: NewsBriefData | undefined;
  keyInsights: string[] | undefined;
  suggestedFollowups: string[] | undefined;
} => ({
  content: message.contentEn ?? message.contentZh ?? message.content,
  newsData: message.newsDataEn ?? message.newsDataZh ?? message.newsData,
  briefData: message.briefDataEn ?? message.briefDataZh ?? message.briefData,
  keyInsights: message.keyInsightsEn ?? message.keyInsightsZh ?? message.keyInsights,
  suggestedFollowups:
    message.suggestedFollowupsEn ?? message.suggestedFollowupsZh ?? message.suggestedFollowups,
});

export const collectDisplayUnits = (message: Message): string[] => {
  const units: string[] = [];
  const view = resolveSourceView(message);
  pushIfNonEmpty(units, view.content);
  collectNewsDataDisplayUnits(view.newsData, units);
  collectBriefDataDisplayUnits(view.briefData, units);
  if (Array.isArray(view.keyInsights)) view.keyInsights.forEach((s) => pushIfNonEmpty(units, s));
  if (Array.isArray(view.suggestedFollowups))
    view.suggestedFollowups.forEach((s) => pushIfNonEmpty(units, s));
  return units;
};
