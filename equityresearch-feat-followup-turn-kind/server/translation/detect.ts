export type TargetLanguage = "en" | "zh";

const CJK_RE = /[一-鿿]/;

export function containsChinese(text?: string | null): boolean {
  return Boolean(text && CJK_RE.test(text));
}

function looksTranslatable(text?: string | null): boolean {
  return Boolean(text && !containsChinese(text) && /[A-Za-z]{3,}/.test(text));
}

export function needsTranslationForLanguage(
  text: string | undefined | null,
  targetLanguage: TargetLanguage,
): boolean {
  if (!text) return false;
  return targetLanguage === "zh" ? looksTranslatable(text) : containsChinese(text);
}

export function payloadNeedsTranslation(value: unknown, targetLanguage: TargetLanguage): boolean {
  if (typeof value === "string") {
    return needsTranslationForLanguage(value, targetLanguage);
  }
  if (Array.isArray(value)) {
    return value.some((entry) => payloadNeedsTranslation(entry, targetLanguage));
  }
  if (value && typeof value === "object") {
    return Object.values(value).some((entry) => payloadNeedsTranslation(entry, targetLanguage));
  }
  return false;
}
