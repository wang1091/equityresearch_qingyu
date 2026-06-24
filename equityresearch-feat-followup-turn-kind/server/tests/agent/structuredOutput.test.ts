import { describe, expect, it } from "vitest";
import { parseStructuredOutput } from "../../agent/generator";
import {
  canonicalizeStructured,
  validateStructuredOutput,
} from "../../agent/structuredOutput";

describe("parseStructuredOutput", () => {
  it("parses clean JSON", () => {
    const out = parseStructuredOutput('{"a":1,"modules":[]}');
    expect(out).toEqual({ a: 1, modules: [] });
  });

  it("strips markdown code fences", () => {
    const out = parseStructuredOutput('```json\n{"verdict":"BUY"}\n```');
    expect(out).toEqual({ verdict: "BUY" });
  });

  it("extracts the first balanced object when wrapped in prose", () => {
    const out = parseStructuredOutput('here you go: {"x":true} thanks');
    expect(out).toEqual({ x: true });
  });

  it("repairs trailing-comma / invalid JSON via jsonrepair", () => {
    const out = parseStructuredOutput('{"a":1,"b":[1,2,],}');
    expect(out).toMatchObject({ a: 1, b: [1, 2] });
  });

  it("returns null when nothing is salvageable", () => {
    expect(parseStructuredOutput("not json at all ¯\\_(ツ)_/¯")).toBeNull();
  });
});

describe("canonicalizeStructured", () => {
  it("folds the EN-variant decision block onto the canonical shape", () => {
    const parsed = canonicalizeStructured({
      Analysis_Decision: {
        verdict: "BUYING Opportunity",
        "red flags": "⚠️ risks apply",
      },
    });
    expect(parsed.Analysis_Decision).toBeUndefined();
    expect(parsed.investment_decision).toBeDefined();
    expect(parsed.investment_decision.verdict).toBe("BUYING Opportunity");
    expect(parsed.investment_decision.red_flags).toBe("⚠️ risks apply");
    expect(parsed.investment_decision["red flags"]).toBeUndefined();
  });

  it("leaves an already-canonical ZH-variant block untouched", () => {
    const parsed = canonicalizeStructured({
      investment_decision: { verdict: "买入机会", red_flags: "⚠️ 投资有风险" },
    });
    expect(parsed.investment_decision.verdict).toBe("买入机会");
    expect(parsed.investment_decision.red_flags).toBe("⚠️ 投资有风险");
  });

  it("does not clobber an existing canonical block with the legacy key", () => {
    const parsed = canonicalizeStructured({
      Analysis_Decision: { verdict: "STALE" },
      investment_decision: { verdict: "CANONICAL" },
    });
    expect(parsed.investment_decision.verdict).toBe("CANONICAL");
    expect(parsed.Analysis_Decision).toBeUndefined();
  });
});

describe("validateStructuredOutput", () => {
  it("passes clean output", () => {
    const warnings = validateStructuredOutput(
      {
        query_understanding: { data_sources_used: ["NEWS", "VALUATION"] },
        modules: [{ module: "News Analyst", rating: "POSITIVE", sources: ["Reuters"] }],
      },
      ["NEWS", "VALUATION"],
    );
    expect(warnings).toEqual([]);
  });

  it("flags an out-of-enum rating", () => {
    const warnings = validateStructuredOutput({
      modules: [
        { module: "News Analyst", rating: "MEGA_BULLISH" },
        { module: "Data Analyst", rating: "STRONG" },
      ],
    });
    expect(warnings.some((w) => w.includes("not in enum"))).toBe(true);
  });

  it("no longer flags missing per-module sources (now TS-derived)", () => {
    const warnings = validateStructuredOutput({
      modules: [{ module: "News Analyst", rating: "POSITIVE" }],
    });
    expect(warnings).toEqual([]);
  });

  it("flags AND prunes fabricated data_sources_used (the teeth)", () => {
    const parsed = {
      query_understanding: { data_sources_used: ["NEWS", "FDA"] },
      modules: [],
    };
    const warnings = validateStructuredOutput(parsed, ["NEWS"]);
    expect(warnings.some((w) => w.includes("un-retrieved sources: FDA"))).toBe(true);
    expect(parsed.query_understanding.data_sources_used).toEqual(["NEWS"]);
  });
});
