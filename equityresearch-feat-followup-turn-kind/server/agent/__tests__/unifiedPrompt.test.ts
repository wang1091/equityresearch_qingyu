import { describe, it, expect } from "vitest";
import { getUnifiedPrompt, META_SEPARATOR } from "../generatorPrompts";

describe("getUnifiedPrompt", () => {
  for (const lang of ["en", "zh"] as const) {
    it(`${lang}: always carries the META separator and markdown-body contract`, () => {
      const p = getUnifiedPrompt(lang, "explainer");
      expect(p).toContain(META_SEPARATOR);
      expect(p.toLowerCase()).toContain("markdown");
    });

    it(`${lang}: decision requires a verdict; lookup/explainer omit it`, () => {
      expect(getUnifiedPrompt(lang, "decision")).toMatch(/verdict/i);
      // non-decision guides explicitly tell the model to omit verdict
      expect(getUnifiedPrompt(lang, "lookup")).toMatch(/omit|省略/i);
      expect(getUnifiedPrompt(lang, "explainer")).toMatch(/omit|省略/i);
    });
  }
});
