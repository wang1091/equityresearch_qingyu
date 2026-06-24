import type { Message } from "@/types";
import type { UILanguage } from "@/utils/i18n";
import { collectDisplayUnits } from "./displayUnits";
import { TRANSLATION_SOURCE_SCHEMA_VERSION } from "./schema";

export const computeSourceFingerprint = (message: Message): string => {
  const units = collectDisplayUnits(message);
  let hash = 0;
  const seed = `v${TRANSLATION_SOURCE_SCHEMA_VERSION}|`;
  const text = seed + units.join("");
  for (let i = 0; i < text.length; i += 1) {
    hash = (hash * 31 + text.charCodeAt(i)) | 0;
  }
  return `${TRANSLATION_SOURCE_SCHEMA_VERSION}:${units.length}:${text.length}:${hash}`;
};

export const isAgentTranslatable = (message: Message): boolean =>
  message.sender === "agent" && message.id !== 1;

export const sourceLanguageOf = (message: Message): UILanguage => {
  if (
    message.contentEn ||
    message.newsDataEn ||
    message.briefDataEn ||
    message.keyInsightsEn ||
    message.suggestedFollowupsEn
  ) {
    return "en";
  }
  if (
    message.contentZh ||
    message.newsDataZh ||
    message.briefDataZh ||
    message.keyInsightsZh ||
    message.suggestedFollowupsZh
  ) {
    return "zh";
  }
  return message.displayLanguage ?? "en";
};

export const isAlreadyTranslated = (message: Message, targetLanguage: UILanguage): boolean => {
  if (!isAgentTranslatable(message)) return true;
  const meta = message.translationMeta;
  if (!meta || meta.v !== TRANSLATION_SOURCE_SCHEMA_VERSION) return false;
  return meta.ready[targetLanguage] === computeSourceFingerprint(message);
};

export const stampTranslationReady = (
  message: Message,
  targetLanguage: UILanguage,
  fingerprint: string,
): Message["translationMeta"] => {
  const prior =
    message.translationMeta?.v === TRANSLATION_SOURCE_SCHEMA_VERSION
      ? message.translationMeta.ready
      : {};
  return {
    v: TRANSLATION_SOURCE_SCHEMA_VERSION,
    ready: { ...prior, [targetLanguage]: fingerprint },
  };
};
