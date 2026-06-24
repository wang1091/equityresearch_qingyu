import { describe, expect, it } from "vitest";
import { splitSseLines } from "../../agent/generator";

describe("splitSseLines", () => {
  it("keeps a partial SSE data line in the remainder", () => {
    const first = splitSseLines('data: {"choices":[{"delta":{"content":"hel');

    expect(first.lines).toEqual([]);
    expect(first.remainder).toBe('data: {"choices":[{"delta":{"content":"hel');

    const second = splitSseLines(`${first.remainder}lo"}}]}\n`);

    expect(second.lines).toEqual(['data: {"choices":[{"delta":{"content":"hello"}}]}']);
    expect(second.remainder).toBe("");
  });

  it("normalizes CRLF lines and leaves the trailing fragment buffered", () => {
    const result = splitSseLines("data: [DONE]\r\n:data comment\r\npartial");

    expect(result.lines).toEqual(["data: [DONE]", ":data comment"]);
    expect(result.remainder).toBe("partial");
  });
});
