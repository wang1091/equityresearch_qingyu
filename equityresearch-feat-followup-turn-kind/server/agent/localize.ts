// Per-source response localizers (translate upstream data to the user's
// language). These produce the FINAL data for a source, so a migrated source's
// plan thunk (planRegistry.ts) calls them after fetching. Moved out of
// apiCaller.ts one at a time as each source migrates to the plan registry.
import {
  containsChinese,
  translateTextToLanguage,
  translateJsonValuesToLanguage,
} from "../translation";

export async function localizeRatingData(data: any, lang?: string): Promise<any> {
  if (lang !== "zh" || !data) {
    return data;
  }

  const translated = await translateJsonValuesToLanguage(
    {
      rating: data.rating || "",
      technical: data.technical || {},
      valuation: data.valuation || {},
      bullish: Array.isArray(data.bullish) ? data.bullish : [],
      bearish: Array.isArray(data.bearish) ? data.bearish : [],
      news: data.news ? { headline: data.news.headline || "" } : null,
      reports: Array.isArray(data.reports)
        ? data.reports.map((report: any) => ({ title: report.title || "" }))
        : [],
    },
    "analyst rating card",
    "zh",
  );

  if (!translated) {
    return data;
  }

  return {
    ...data,
    rating: translated.rating || data.rating,
    technical: { ...data.technical, ...translated.technical },
    valuation: { ...data.valuation, ...translated.valuation },
    bullish: translated.bullish || data.bullish,
    bearish: translated.bearish || data.bearish,
    news: data.news
      ? { ...data.news, headline: translated.news?.headline || data.news.headline }
      : data.news,
    reports: Array.isArray(data.reports)
      ? data.reports.map((report: any, index: number) => ({
          ...report,
          title: translated.reports?.[index]?.title || report.title,
        }))
      : data.reports,
  };
}

export async function localizeRumorData(data: any, lang?: string): Promise<any> {
  if (lang !== "zh" || !data) {
    return data;
  }

  const localized = { ...data };

  if (localized.report?.markdown && !containsChinese(localized.report.markdown)) {
    localized.report = {
      ...localized.report,
      markdown: await translateTextToLanguage(localized.report.markdown, "zh", "markdown"),
    };
  }

  const earningsVerification = localized.data?.earnings_verification;
  if (earningsVerification) {
    const translated = await translateJsonValuesToLanguage(
      {
        verdict: earningsVerification.verdict || "",
        summary: earningsVerification.summary || "",
        relevant_info: earningsVerification.relevant_info || "",
        evidence: earningsVerification.evidence || "",
      },
      "rumor earnings verification",
      "zh",
    );

    if (translated) {
      localized.data = {
        ...localized.data,
        earnings_verification: {
          ...earningsVerification,
          ...translated,
        },
      };
    }
  }

  return localized;
}
