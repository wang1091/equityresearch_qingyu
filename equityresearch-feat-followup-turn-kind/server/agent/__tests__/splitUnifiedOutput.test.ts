import { describe, it, expect } from "vitest";
import { splitUnifiedOutput } from "../generator";
import { META_SEPARATOR } from "../generatorPrompts";

describe("splitUnifiedOutput", () => {
  it("splits body and parses a verdict from the META tail", () => {
    const raw = `## 估值\n英伟达偏高。\n${META_SEPARATOR}\n{ "verdict": { "stance": "OVERVALUED", "conviction": "MEDIUM", "priceTarget": "$120" } }`;
    const { body, verdict } = splitUnifiedOutput(raw);
    expect(body).toBe("## 估值\n英伟达偏高。");
    expect(verdict).toEqual({ stance: "OVERVALUED", conviction: "MEDIUM", priceTarget: "$120" });
  });

  it("no separator → whole text is the body, no verdict", () => {
    const { body, verdict } = splitUnifiedOutput("Just a short answer.");
    expect(body).toBe("Just a short answer.");
    expect(verdict).toBeUndefined();
  });

  it("tolerates a fenced JSON META block", () => {
    const raw = `body text\n${META_SEPARATOR}\n\`\`\`json\n{ "verdict": { "stance": "NEUTRAL" } }\n\`\`\``;
    expect(splitUnifiedOutput(raw).verdict).toEqual({ stance: "NEUTRAL" });
  });

  it("invalid META JSON → body kept, verdict dropped (graceful)", () => {
    const raw = `body\n${META_SEPARATOR}\nnot json {`;
    const { body, verdict } = splitUnifiedOutput(raw);
    expect(body).toBe("body");
    expect(verdict).toBeUndefined();
  });

  it("ignores a verdict with no stance", () => {
    const raw = `body\n${META_SEPARATOR}\n{ "verdict": { "conviction": "LOW" } }`;
    expect(splitUnifiedOutput(raw).verdict).toBeUndefined();
  });
});
