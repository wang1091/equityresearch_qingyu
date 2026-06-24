import { describe, it, expect } from "vitest";
import type { Message, NewsV2Data } from "@/types";
import {
  computeSourceFingerprint,
  isAgentTranslatable,
  sourceLanguageOf,
  isAlreadyTranslated,
  stampTranslationReady,
} from "../fingerprint";
import { TRANSLATION_SOURCE_SCHEMA_VERSION } from "../schema";

const agentMessage = (overrides: Partial<Message> = {}): Message => ({
  id: 2,
  content: "",
  sender: "agent",
  timestamp: new Date("2026-01-01T00:00:00Z"),
  ...overrides,
});

describe("isAgentTranslatable", () => {
  it("returns false for the welcome message (id=1)", () => {
    expect(isAgentTranslatable({ ...agentMessage(), id: 1 })).toBe(false);
  });

  it("returns false for user messages", () => {
    expect(isAgentTranslatable({ ...agentMessage(), sender: "user" })).toBe(false);
  });

  it("returns true for normal agent messages", () => {
    expect(isAgentTranslatable(agentMessage())).toBe(true);
  });
});

describe("sourceLanguageOf", () => {
  it("returns 'en' when any *En cache is set", () => {
    expect(sourceLanguageOf(agentMessage({ contentEn: "x" }))).toBe("en");
  });

  it("returns 'zh' when any *Zh cache is set and no *En", () => {
    expect(sourceLanguageOf(agentMessage({ contentZh: "x" }))).toBe("zh");
  });

  it("falls back to displayLanguage when no cache is set", () => {
    expect(sourceLanguageOf(agentMessage({ displayLanguage: "zh" }))).toBe("zh");
  });

  it("defaults to 'en' when nothing is known", () => {
    expect(sourceLanguageOf(agentMessage())).toBe("en");
  });
});

describe("computeSourceFingerprint", () => {
  it("is stable across calls for the same source content", () => {
    const msg = agentMessage({ contentEn: "hello world" });
    expect(computeSourceFingerprint(msg)).toBe(computeSourceFingerprint(msg));
  });

  it("changes when source content changes", () => {
    const a = agentMessage({ contentEn: "first version" });
    const b = agentMessage({ contentEn: "second version" });
    expect(computeSourceFingerprint(a)).not.toBe(computeSourceFingerprint(b));
  });

  it("does NOT change when only metadata fields change", () => {
    const newsBase: NewsV2Data = {
      content: { summary: "same summary", title: "same title" },
      search_results: [
        {
          title: "src",
          snippet: "snippet",
          url: "https://example.com/a",
          publisher: "Reuters",
        },
      ],
      citations: ["https://example.com/a"],
      meta: { model: "gpt-4" },
    };
    const newsWithDifferentMeta: NewsV2Data = {
      ...newsBase,
      search_results: [
        {
          title: "src",
          snippet: "snippet",
          url: "https://example.com/a",
          publisher: "Bloomberg",
          provider_source_type: "search",
          provenance: "citations_backfill",
        },
      ],
      citations: ["https://different.example/b"],
      meta: { model: "claude-4" },
    };

    const a = agentMessage({ newsDataEn: newsBase });
    const b = agentMessage({ newsDataEn: newsWithDifferentMeta });
    expect(computeSourceFingerprint(a)).toBe(computeSourceFingerprint(b));
  });

  it("ignores translated content (uses canonical source)", () => {
    const msg = agentMessage({
      contentEn: "english source",
      contentZh: "this changes",
      content: "this also changes",
    });
    const baseline = computeSourceFingerprint(msg);
    const drifted = computeSourceFingerprint({
      ...msg,
      contentZh: "different translation",
      content: "different display",
    });
    expect(baseline).toBe(drifted);
  });
});

describe("isAlreadyTranslated", () => {
  const fingerprintFor = (msg: Message) => computeSourceFingerprint(msg);

  it("returns true for non-translatable messages (welcome / user)", () => {
    expect(isAlreadyTranslated({ ...agentMessage(), id: 1 }, "zh")).toBe(true);
    expect(isAlreadyTranslated({ ...agentMessage(), sender: "user" }, "en")).toBe(true);
  });

  it("returns false when translationMeta is missing", () => {
    expect(isAlreadyTranslated(agentMessage({ contentEn: "x" }), "zh")).toBe(false);
  });

  it("returns true when meta entry matches the current source fingerprint", () => {
    const msg = agentMessage({ contentEn: "hello" });
    const fp = fingerprintFor(msg);
    const stamped: Message = {
      ...msg,
      translationMeta: { v: TRANSLATION_SOURCE_SCHEMA_VERSION, ready: { zh: fp } },
    };
    expect(isAlreadyTranslated(stamped, "zh")).toBe(true);
  });

  it("returns false when the source has changed since stamping", () => {
    const original = agentMessage({ contentEn: "hello" });
    const fp = fingerprintFor(original);
    const stamped: Message = {
      ...original,
      contentEn: "hello edited",
      translationMeta: { v: TRANSLATION_SOURCE_SCHEMA_VERSION, ready: { zh: fp } },
    };
    expect(isAlreadyTranslated(stamped, "zh")).toBe(false);
  });

  it("returns false when the schema version is older", () => {
    const msg = agentMessage({ contentEn: "hello" });
    const fp = fingerprintFor(msg);
    const stamped: Message = {
      ...msg,
      translationMeta: { v: TRANSLATION_SOURCE_SCHEMA_VERSION - 1, ready: { zh: fp } },
    };
    expect(isAlreadyTranslated(stamped, "zh")).toBe(false);
  });

  it("returns false when target language was never stamped", () => {
    const msg = agentMessage({ contentEn: "hello" });
    const fp = fingerprintFor(msg);
    const stamped: Message = {
      ...msg,
      translationMeta: { v: TRANSLATION_SOURCE_SCHEMA_VERSION, ready: { en: fp } },
    };
    expect(isAlreadyTranslated(stamped, "zh")).toBe(false);
  });

  it("ignores changes to non-display fields (publisher etc.) — the bug-fix invariant", () => {
    const baseNews: NewsV2Data = {
      content: { summary: "summary" },
      search_results: [{ title: "t", snippet: "s", url: "u", publisher: "Reuters" }],
      citations: [],
    };
    const msg = agentMessage({ newsDataEn: baseNews });
    const fp = fingerprintFor(msg);
    const drifted: Message = {
      ...msg,
      newsDataEn: {
        ...baseNews,
        search_results: [
          { title: "t", snippet: "s", url: "u", publisher: "Bloomberg" },
        ],
      },
      translationMeta: { v: TRANSLATION_SOURCE_SCHEMA_VERSION, ready: { zh: fp } },
    };
    expect(isAlreadyTranslated(drifted, "zh")).toBe(true);
  });
});

describe("stampTranslationReady", () => {
  it("creates a fresh meta when none exists", () => {
    const msg = agentMessage();
    const meta = stampTranslationReady(msg, "zh", "FP_1");
    expect(meta).toEqual({
      v: TRANSLATION_SOURCE_SCHEMA_VERSION,
      ready: { zh: "FP_1" },
    });
  });

  it("preserves prior entries with the same schema version", () => {
    const msg = agentMessage({
      translationMeta: {
        v: TRANSLATION_SOURCE_SCHEMA_VERSION,
        ready: { en: "FP_EN" },
      },
    });
    const meta = stampTranslationReady(msg, "zh", "FP_ZH");
    expect(meta?.ready).toEqual({ en: "FP_EN", zh: "FP_ZH" });
  });

  it("discards prior entries on schema version mismatch", () => {
    const msg = agentMessage({
      translationMeta: {
        v: TRANSLATION_SOURCE_SCHEMA_VERSION - 1,
        ready: { en: "STALE" },
      },
    });
    const meta = stampTranslationReady(msg, "zh", "FP_ZH");
    expect(meta).toEqual({
      v: TRANSLATION_SOURCE_SCHEMA_VERSION,
      ready: { zh: "FP_ZH" },
    });
  });

  it("overwrites the same target language", () => {
    const msg = agentMessage({
      translationMeta: {
        v: TRANSLATION_SOURCE_SCHEMA_VERSION,
        ready: { zh: "OLD" },
      },
    });
    const meta = stampTranslationReady(msg, "zh", "NEW");
    expect(meta?.ready.zh).toBe("NEW");
  });
});
