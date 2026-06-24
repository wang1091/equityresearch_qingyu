import { describe, it, expect } from "vitest";
import { stableStringify, getContentHash } from "../hash";

describe("stableStringify", () => {
  it("returns identical strings regardless of object key order", () => {
    const a = { foo: 1, bar: 2, baz: { x: "x", y: "y" } };
    const b = { baz: { y: "y", x: "x" }, bar: 2, foo: 1 };
    expect(stableStringify(a)).toBe(stableStringify(b));
  });

  it("preserves array element order", () => {
    expect(stableStringify([1, 2, 3])).not.toBe(stableStringify([3, 2, 1]));
  });

  it("handles null, undefined, numbers, strings, booleans", () => {
    expect(stableStringify(null)).toBe("null");
    expect(stableStringify(undefined)).toBe("undefined");
    expect(stableStringify(42)).toBe("42");
    expect(stableStringify("hi")).toBe('"hi"');
    expect(stableStringify(true)).toBe("true");
  });

  it("walks nested arrays inside objects", () => {
    const out = stableStringify({ a: [1, { b: 2, a: 1 }] });
    expect(out).toBe('{"a":[1,{"a":1,"b":2}]}');
  });
});

describe("getContentHash", () => {
  it("is deterministic for the same input", () => {
    const value = { foo: "bar", items: [1, 2, 3] };
    expect(getContentHash(value)).toBe(getContentHash(value));
  });

  it("returns the same hash for objects with reordered keys", () => {
    expect(getContentHash({ a: 1, b: 2 })).toBe(getContentHash({ b: 2, a: 1 }));
  });

  it("returns different hashes for different content", () => {
    expect(getContentHash({ a: 1 })).not.toBe(getContentHash({ a: 2 }));
  });

  it("returns a string in the form length:hash", () => {
    expect(getContentHash({ a: 1 })).toMatch(/^\d+:-?\d+$/);
  });
});
