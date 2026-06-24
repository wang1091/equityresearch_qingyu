import { describe, expect, it } from "vitest";
import { cleanJsonResponse } from "../utils";

// Guards the reasoning-model hardening: a local Qwen3/gpt-oss model in LM Studio
// may wrap the JSON in <think>…</think>; without stripping it the classifier's
// JSON.parse fails and silently drops to keyword fallback.
describe("cleanJsonResponse", () => {
  it("returns plain JSON unchanged", () => {
    expect(cleanJsonResponse('{"a":1}')).toBe('{"a":1}');
  });

  it("strips ```json fences", () => {
    expect(cleanJsonResponse('```json\n{"a":1}\n```')).toBe('{"a":1}');
  });

  it("strips a <think> block before the JSON", () => {
    const raw = '<think>\nThe user wants Tesla earnings...\n</think>\n\n{"primary_focus":"EARNINGS"}';
    expect(cleanJsonResponse(raw)).toBe('{"primary_focus":"EARNINGS"}');
  });

  it("strips a <think> block even when the JSON is fenced", () => {
    const raw = '<think>reasoning</think>\n```json\n{"a":1}\n```';
    expect(cleanJsonResponse(raw)).toBe('{"a":1}');
  });

  it("drops a stray unclosed <think> tag", () => {
    expect(cleanJsonResponse('<think>{"a":1}')).toBe('{"a":1}');
  });
});
