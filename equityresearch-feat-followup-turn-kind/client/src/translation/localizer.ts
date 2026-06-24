import type { Message } from "@/types";
import type { UILanguage } from "@/utils/i18n";
import { isLikelyJsonPayload, parseLooseJson, tryParseResearchJson } from "@/components";
import { translateVisibleContent, translateNewsDataForLanguage } from "./api";
import { getContentHash } from "./hash";
import {
  computeSourceFingerprint,
  isAgentTranslatable,
  isAlreadyTranslated,
  stampTranslationReady,
} from "./fingerprint";

/**
 * Swap the "live" fields (`content`, `newsData`, etc.) to the target-language cached copies.
 *
 * Why: each translation pass overwrites the live fields in place, so after EN → ZH the
 * message's `.newsData` points at Chinese. When the user toggles back to EN and the
 * fingerprint says "already translated", we must still flip the live fields back to the
 * cached `newsDataEn` — otherwise the UI keeps rendering the Chinese copy under English
 * labels.
 */
const swapLiveFieldsToLanguage = (message: Message, targetLanguage: UILanguage): Message => {
  if (message.displayLanguage === targetLanguage) {
    return message;
  }
  const next: Message = { ...message, displayLanguage: targetLanguage };
  if (targetLanguage === "zh") {
    if (next.contentZh !== undefined) next.content = next.contentZh;
    if (next.newsDataZh !== undefined) next.newsData = next.newsDataZh;
    if (next.briefDataZh !== undefined) next.briefData = next.briefDataZh;
    if (next.keyInsightsZh !== undefined) next.keyInsights = next.keyInsightsZh;
    if (next.suggestedFollowupsZh !== undefined) next.suggestedFollowups = next.suggestedFollowupsZh;
  } else {
    if (next.contentEn !== undefined) next.content = next.contentEn;
    if (next.newsDataEn !== undefined) next.newsData = next.newsDataEn;
    if (next.briefDataEn !== undefined) next.briefData = next.briefDataEn;
    if (next.keyInsightsEn !== undefined) next.keyInsights = next.keyInsightsEn;
    if (next.suggestedFollowupsEn !== undefined) next.suggestedFollowups = next.suggestedFollowupsEn;
  }
  return next;
};

export const localizeMessageForLanguage = async (
  message: Message,
  targetLanguage: UILanguage,
  sourceLanguage: UILanguage,
): Promise<Message> => {
  if (!isAgentTranslatable(message)) {
    return message;
  }

  if (isAlreadyTranslated(message, targetLanguage)) {
    return swapLiveFieldsToLanguage(message, targetLanguage);
  }

  const currentLanguage = message.displayLanguage || sourceLanguage;

  // Streamed content is already in the user's language — stamp ready and
  // skip the DeepSeek HTML translate pass. That pass has a 2000-token ceiling
  // which silently truncates large cards (e.g. Performance card with SVG +
  // multi-quarter tables), making the trailing content "disappear" a few
  // seconds after the initial render.
  if (currentLanguage === targetLanguage) {
    return {
      ...message,
      displayLanguage: targetLanguage,
      translationMeta: stampTranslationReady(
        message,
        targetLanguage,
        computeSourceFingerprint(message),
      ),
    };
  }

  const next: Message = { ...message };
  const tasks: Array<Promise<void>> = [];
  const taskStart = performance.now();

  const targetContentKey = targetLanguage === "zh" ? "contentZh" : "contentEn";
  const sourceContentKey = currentLanguage === "zh" ? "contentZh" : "contentEn";
  const targetContentHashKey = targetLanguage === "zh" ? "contentZhHash" : "contentEnHash";
  const sourceContentHashKey = currentLanguage === "zh" ? "contentZhHash" : "contentEnHash";

  if (next.content) {
    const sourceHash = getContentHash(next.content);
    if (!next[sourceContentKey]) {
      next[sourceContentKey] = next.content;
      next[sourceContentHashKey] = sourceHash;
    }

    if (
      next[targetContentKey] &&
      next[targetContentHashKey] === sourceHash
    ) {
      next.content = next[targetContentKey]!;
    } else {
      tasks.push((async () => {
        const parsedResearch = tryParseResearchJson(next.content);
        if (parsedResearch) {
          const translated = await translateVisibleContent(parsedResearch, targetLanguage, "json");
          next.content = JSON.stringify(translated);
          next[targetContentKey] = next.content;
          next[targetContentHashKey] = sourceHash;
        } else {
          const raw = next.content;
          const keepRawJson =
            isLikelyJsonPayload(raw) && parseLooseJson(raw) !== null;
          if (keepRawJson) {
            // HTML translation mangles JSON payloads; keep verbatim for any parseable JSON
            next[targetContentKey] = raw;
            next[targetContentHashKey] = sourceHash;
          } else {
            next.content = await translateVisibleContent(raw, targetLanguage, "html");
            next[targetContentKey] = next.content;
            next[targetContentHashKey] = sourceHash;
          }
        }
      })());
    }
  }

  const targetNewsKey = targetLanguage === "zh" ? "newsDataZh" : "newsDataEn";
  const sourceNewsKey = currentLanguage === "zh" ? "newsDataZh" : "newsDataEn";
  const targetNewsHashKey = targetLanguage === "zh" ? "newsDataZhHash" : "newsDataEnHash";
  const sourceNewsHashKey = currentLanguage === "zh" ? "newsDataZhHash" : "newsDataEnHash";
  if (next.newsData) {
    const sourceHash = getContentHash(next.newsData);
    if (!next[sourceNewsKey]) {
      next[sourceNewsKey] = next.newsData;
      next[sourceNewsHashKey] = sourceHash;
    }
    if (
      next[targetNewsKey] &&
      next[targetNewsHashKey] === sourceHash
    ) {
      next.newsData = next[targetNewsKey];
    } else {
      tasks.push((async () => {
        next.newsData = await translateNewsDataForLanguage(next.newsData!, targetLanguage);
        next[targetNewsKey] = next.newsData;
        next[targetNewsHashKey] = sourceHash;
      })());
    }
  }

  const targetBriefKey = targetLanguage === "zh" ? "briefDataZh" : "briefDataEn";
  const sourceBriefKey = currentLanguage === "zh" ? "briefDataZh" : "briefDataEn";
  const targetBriefHashKey = targetLanguage === "zh" ? "briefDataZhHash" : "briefDataEnHash";
  const sourceBriefHashKey = currentLanguage === "zh" ? "briefDataZhHash" : "briefDataEnHash";
  if (next.briefData) {
    const sourceHash = getContentHash(next.briefData);
    if (!next[sourceBriefKey]) {
      next[sourceBriefKey] = next.briefData;
      next[sourceBriefHashKey] = sourceHash;
    }
    if (
      next[targetBriefKey] &&
      next[targetBriefHashKey] === sourceHash
    ) {
      next.briefData = next[targetBriefKey];
    } else {
      tasks.push((async () => {
        next.briefData = await translateVisibleContent(next.briefData!, targetLanguage, "json");
        next[targetBriefKey] = next.briefData;
        next[targetBriefHashKey] = sourceHash;
      })());
    }
  }

  const targetInsightsKey = targetLanguage === "zh" ? "keyInsightsZh" : "keyInsightsEn";
  const sourceInsightsKey = currentLanguage === "zh" ? "keyInsightsZh" : "keyInsightsEn";
  const targetInsightsHashKey = targetLanguage === "zh" ? "keyInsightsZhHash" : "keyInsightsEnHash";
  const sourceInsightsHashKey = currentLanguage === "zh" ? "keyInsightsZhHash" : "keyInsightsEnHash";
  if (next.keyInsights?.length) {
    const sourceHash = getContentHash(next.keyInsights);
    if (!next[sourceInsightsKey]) {
      next[sourceInsightsKey] = next.keyInsights;
      next[sourceInsightsHashKey] = sourceHash;
    }
    if (
      next[targetInsightsKey] &&
      next[targetInsightsHashKey] === sourceHash
    ) {
      next.keyInsights = next[targetInsightsKey];
    } else {
      tasks.push((async () => {
        next.keyInsights = await translateVisibleContent(next.keyInsights!, targetLanguage, "json");
        next[targetInsightsKey] = next.keyInsights;
        next[targetInsightsHashKey] = sourceHash;
      })());
    }
  }

  const targetFollowupsKey = targetLanguage === "zh" ? "suggestedFollowupsZh" : "suggestedFollowupsEn";
  const sourceFollowupsKey = currentLanguage === "zh" ? "suggestedFollowupsZh" : "suggestedFollowupsEn";
  const targetFollowupsHashKey = targetLanguage === "zh" ? "suggestedFollowupsZhHash" : "suggestedFollowupsEnHash";
  const sourceFollowupsHashKey = currentLanguage === "zh" ? "suggestedFollowupsZhHash" : "suggestedFollowupsEnHash";
  if (next.suggestedFollowups?.length) {
    const sourceHash = getContentHash(next.suggestedFollowups);
    if (!next[sourceFollowupsKey]) {
      next[sourceFollowupsKey] = next.suggestedFollowups;
      next[sourceFollowupsHashKey] = sourceHash;
    }
    if (
      next[targetFollowupsKey] &&
      next[targetFollowupsHashKey] === sourceHash
    ) {
      next.suggestedFollowups = next[targetFollowupsKey];
    } else {
      tasks.push((async () => {
        next.suggestedFollowups = await translateVisibleContent(next.suggestedFollowups!, targetLanguage, "json");
        next[targetFollowupsKey] = next.suggestedFollowups;
        next[targetFollowupsHashKey] = sourceHash;
      })());
    }
  }

  if (tasks.length > 0) {
    console.log("[i18n] localize: dispatching", tasks.length, "parallel tasks for message", message.id);
    await Promise.all(tasks);
    console.log("[i18n] localize: message", message.id, "tasks done in", Math.round(performance.now() - taskStart), "ms");
  }

  next.displayLanguage = targetLanguage;
  next.translationMeta = stampTranslationReady(
    next,
    targetLanguage,
    computeSourceFingerprint(next),
  );
  return next;
};
