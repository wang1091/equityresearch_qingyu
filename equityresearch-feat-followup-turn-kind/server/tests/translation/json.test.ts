// Behavior net for the chunked JSON translator (server/translation/json.ts)
// after the P4 consolidation onto the shared LLM layer. The DeepSeek transport
// is exercised through deepSeekChatProvider, so global fetch is stubbed to a
// DeepSeek-shaped chat-completions body. Pins: happy translation, the
// array-length-mismatch bucket rejection, and the finish_reason="length"
// (truncation) rejection — the messiest part the migration must preserve.
import { describe, it, expect, afterEach, vi } from "vitest";
import { translateJsonValuesToLanguage } from "../../translation/json";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

/** A DeepSeek /chat/completions response carrying `content`. */
function deepSeekBody(content: string, finish_reason = "stop") {
  return new Response(
    JSON.stringify({ choices: [{ message: { content }, finish_reason }] }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

function stubFetch(impl: (url: string, init?: any) => Promise<Response>) {
  const fn = vi.fn(impl);
  vi.stubGlobal("fetch", fn);
  return fn;
}

describe("translateJsonValuesToLanguage (P4)", () => {
  it("translates string leaves in order and applies them back", async () => {
    vi.stubEnv("DEEPSEEK_API_KEY", "ds-key");
    const fetchMock = stubFetch(async () =>
      deepSeekBody(JSON.stringify({ strings: ["你好", "世界"] })),
    );

    const result = await translateJsonValuesToLanguage(["Hello", "World"], "test", "zh");

    expect(String(fetchMock.mock.calls[0][0])).toContain("api.deepseek.com/chat/completions");
    expect(result).toEqual(["你好", "世界"]);
  });

  it("rejects a bucket whose array length doesn't match (→ null, no partial apply)", async () => {
    vi.stubEnv("DEEPSEEK_API_KEY", "ds-key");
    stubFetch(async () => deepSeekBody(JSON.stringify({ strings: ["仅一个"] })));

    // Single bucket, all leaves fail → whole call returns null (caller keeps original).
    const result = await translateJsonValuesToLanguage(["Hello", "World"], "test", "zh");
    expect(result).toBeNull();
  });

  it("rejects a truncated bucket (finish_reason='length' → null)", async () => {
    vi.stubEnv("DEEPSEEK_API_KEY", "ds-key");
    stubFetch(async () =>
      deepSeekBody(JSON.stringify({ strings: ["你好", "世界"] }), "length"),
    );

    const result = await translateJsonValuesToLanguage(["Hello", "World"], "test", "zh");
    expect(result).toBeNull();
  });

  it("returns null without calling out when there is no DeepSeek key", async () => {
    vi.stubEnv("DEEPSEEK_API_KEY", "");
    vi.stubEnv("DEEPSEEK_KEY", "");
    const fetchMock = stubFetch(async () => deepSeekBody("{}"));

    const result = await translateJsonValuesToLanguage(["Hello", "World"], "test", "zh");
    expect(result).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
