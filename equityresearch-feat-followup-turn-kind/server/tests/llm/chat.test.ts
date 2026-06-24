// Unit tests for the provider-failover layer (server/llm/chat.ts):
// failover routing, error classification, the Gemini adapter mapping, and the
// default chain's GEMINI_API_KEY gating.
import { describe, it, expect, afterEach, vi } from "vitest";
import {
  callChatWithFailover,
  callChatStreamWithFailover,
  isFailoverError,
  httpStatusOf,
  ChatHttpError,
  ChatAbortError,
  geminiChatProvider,
  geminiSearchProvider,
  perplexityChatProvider,
  resolveChatChain,
  type ChatProvider,
  type ChatResponse,
} from "../../llm/chat";

import { __resetHttpClientStateForTests } from "../../../http/httpClient";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  // The non-streaming providers now share http/createRequestJson, whose circuit
  // breaker state is module-global — reset it so failure counts don't leak
  // between tests.
  __resetHttpClientStateForTests();
});

const ok = (content: string): ChatResponse => ({
  choices: [{ message: { content } }],
});

/** A provider whose call() is a vi.fn so we can assert call counts/order. */
function fakeProvider(id: string, impl: () => Promise<ChatResponse>): ChatProvider & { calls: number } {
  const p = {
    id,
    calls: 0,
    call: vi.fn(async () => {
      p.calls++;
      return impl();
    }),
  };
  return p;
}

describe("httpStatusOf / isFailoverError", () => {
  it("extracts status from a ChatHttpError", () => {
    expect(httpStatusOf(new ChatHttpError("deepseek", 402, "Insufficient Balance"))).toBe(402);
    expect(httpStatusOf(new Error("plain"))).toBeUndefined();
  });

  it("fails over on 401/402/403/429/5xx, timeout, and transport errors", () => {
    for (const s of [401, 402, 403, 429, 500, 503]) {
      expect(isFailoverError(new ChatHttpError("x", s, ""))).toBe(true);
    }
    const timeout = Object.assign(new Error("aborted"), { name: "TimeoutError" });
    expect(isFailoverError(timeout)).toBe(true);
    expect(isFailoverError(new TypeError("fetch failed"))).toBe(true);
  });

  it("does NOT fail over on 400 (bad request fails everywhere)", () => {
    expect(isFailoverError(new ChatHttpError("x", 400, ""))).toBe(false);
  });

  it("fails over on an upstream timeout but NOT on a client-disconnect", () => {
    expect(isFailoverError(new ChatAbortError("deepseek", "upstream_timeout"))).toBe(true);
    // Client is gone — trying the fallback would only burn more tokens.
    expect(isFailoverError(new ChatAbortError("deepseek", "client_disconnect"))).toBe(false);
    expect(isFailoverError(new ChatAbortError("deepseek", "pipeline_timeout"))).toBe(false);
  });
});

describe("callChatWithFailover", () => {
  const req = { messages: [{ role: "user" as const, content: "hi" }] };

  it("returns the primary's response without touching the fallback on success", async () => {
    const primary = fakeProvider("deepseek", async () => ok("primary"));
    const fallback = fakeProvider("gemini", async () => ok("fallback"));
    const { response, providerId } = await callChatWithFailover([primary, fallback], req);
    expect(providerId).toBe("deepseek");
    expect(response.choices?.[0]?.message?.content).toBe("primary");
    expect(fallback.calls).toBe(0);
  });

  it("advances to the fallback on a 402 (out of balance)", async () => {
    const primary = fakeProvider("deepseek", async () => {
      throw new ChatHttpError("deepseek", 402, "Insufficient Balance");
    });
    const fallback = fakeProvider("gemini", async () => ok("fallback"));
    const { response, providerId } = await callChatWithFailover([primary, fallback], req);
    expect(providerId).toBe("gemini");
    expect(response.choices?.[0]?.message?.content).toBe("fallback");
    expect(primary.calls).toBe(1);
    expect(fallback.calls).toBe(1);
  });

  it("advances when the primary returns empty content", async () => {
    const primary = fakeProvider("deepseek", async () => ok(""));
    const fallback = fakeProvider("gemini", async () => ok("fallback"));
    const { providerId } = await callChatWithFailover([primary, fallback], req);
    expect(providerId).toBe("gemini");
  });

  it("is terminal on a 400 — does not try the fallback, rethrows", async () => {
    const primary = fakeProvider("deepseek", async () => {
      throw new ChatHttpError("deepseek", 400, "bad request");
    });
    const fallback = fakeProvider("gemini", async () => ok("fallback"));
    await expect(callChatWithFailover([primary, fallback], req)).rejects.toMatchObject({ status: 400 });
    expect(fallback.calls).toBe(0);
  });

  it("rethrows the LAST provider's error when all fail (preserves HTTP status)", async () => {
    const primary = fakeProvider("deepseek", async () => {
      throw new ChatHttpError("deepseek", 402, "");
    });
    const fallback = fakeProvider("gemini", async () => {
      throw new ChatHttpError("gemini", 503, "down");
    });
    await expect(callChatWithFailover([primary, fallback], req)).rejects.toMatchObject({
      providerId: "gemini",
      status: 503,
    });
  });

  it("returns the last provider's empty response (caller handles empty)", async () => {
    const only = fakeProvider("deepseek", async () => ok(""));
    const { providerId, response } = await callChatWithFailover([only], req);
    expect(providerId).toBe("deepseek");
    expect(response.choices?.[0]?.message?.content).toBe("");
  });

  it("throws when the chain is empty", async () => {
    await expect(callChatWithFailover([], req)).rejects.toThrow(/no providers/i);
  });

  it("does NOT fall over to the fallback on a client-disconnect", async () => {
    const primary = fakeProvider("deepseek", async () => {
      throw new ChatAbortError("deepseek", "client_disconnect");
    });
    const fallback = fakeProvider("gemini", async () => ok("should not run"));
    await expect(callChatWithFailover([primary, fallback], req)).rejects.toBeInstanceOf(ChatAbortError);
    expect(fallback.calls).toBe(0); // client gone → no extra token burn
  });
});

describe("geminiChatProvider adapter", () => {
  const provider = geminiChatProvider("gem-key", "gemini-2.5-flash");

  it("maps system→systemInstruction, roles, json mode, and the response back", async () => {
    let captured: any;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init: any) => {
        captured = { url, body: JSON.parse(init.body) };
        return new Response(
          JSON.stringify({
            candidates: [{ content: { parts: [{ text: '{"ok":true}' }] }, finishReason: "STOP" }],
          }),
          { status: 200 },
        );
      }),
    );

    const res = await provider.call({
      messages: [
        { role: "system", content: "be precise" },
        { role: "assistant", content: "prior turn" },
        { role: "user", content: "classify this" },
      ],
      temperature: 0,
      max_tokens: 600,
      response_format: { type: "json_object" },
    });

    expect(String(captured.url)).toContain("gemini-2.5-flash:generateContent");
    expect(captured.body.systemInstruction).toEqual({ parts: [{ text: "be precise" }] });
    // assistant → model, user → user; system excluded from contents
    expect(captured.body.contents).toEqual([
      { role: "model", parts: [{ text: "prior turn" }] },
      { role: "user", parts: [{ text: "classify this" }] },
    ]);
    expect(captured.body.generationConfig).toMatchObject({
      temperature: 0,
      maxOutputTokens: 600,
      responseMimeType: "application/json",
    });
    expect(res.choices?.[0]?.message?.content).toBe('{"ok":true}');
  });

  it("maps Gemini MAX_TOKENS to finish_reason 'length'", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({ candidates: [{ content: { parts: [{ text: "x" }] }, finishReason: "MAX_TOKENS" }] }),
          { status: 200 },
        ),
      ),
    );
    const res = await provider.call({ messages: [{ role: "user", content: "hi" }] });
    expect(res.choices?.[0]?.finish_reason).toBe("length");
  });

  it("throws ChatHttpError carrying the status on a non-2xx", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("quota", { status: 429 })));
    await expect(provider.call({ messages: [{ role: "user", content: "hi" }] })).rejects.toMatchObject({
      status: 429,
      providerId: "gemini",
    });
  });
});

describe("geminiSearchProvider adapter", () => {
  const provider = geminiSearchProvider("gem-key", "gemini-2.5-flash");

  it("adds the google_search tool and does NOT set responseMimeType even in JSON mode", async () => {
    let captured: any;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init: any) => {
        captured = { url, body: JSON.parse(init.body) };
        return new Response(
          JSON.stringify({ candidates: [{ content: { parts: [{ text: "grounded answer" }] } }] }),
          { status: 200 },
        );
      }),
    );

    const res = await provider.call({
      messages: [
        { role: "system", content: "be precise" },
        { role: "user", content: "latest NVDA news" },
      ],
      temperature: 0.3,
      max_tokens: 1500,
      // JSON mode requested, but google_search is incompatible with it → must be ignored.
      response_format: { type: "json_object" },
    });

    expect(String(captured.url)).toContain("gemini-2.5-flash:generateContent");
    expect(captured.body.tools).toEqual([{ google_search: {} }]);
    expect(captured.body.generationConfig).not.toHaveProperty("responseMimeType");
    expect(captured.body.generationConfig).toMatchObject({ temperature: 0.3, maxOutputTokens: 1500 });
    expect(captured.body.systemInstruction).toEqual({ parts: [{ text: "be precise" }] });
    expect(res.choices?.[0]?.message?.content).toBe("grounded answer");
  });

  it("shares the provider id 'gemini' (so the chain reports it as the gemini hop)", () => {
    expect(provider.id).toBe("gemini");
  });
});

describe("perplexityChatProvider adapter", () => {
  const provider = perplexityChatProvider("pplx-key");

  it("POSTs to the Perplexity endpoint with auth + search params, and surfaces citations", async () => {
    let captured: any;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init: any) => {
        // The shared transport normalizes headers into a Headers instance.
        captured = { url, headers: new Headers(init.headers), body: JSON.parse(init.body) };
        return new Response(
          JSON.stringify({
            choices: [{ message: { content: "answer" } }],
            citations: ["https://a.com", "https://b.com"],
          }),
          { status: 200 },
        );
      }),
    );

    const res = await provider.call({
      messages: [{ role: "user", content: "recommend stocks" }],
      max_tokens: 1500,
      search_recency_filter: "month",
      return_related_questions: false,
    });

    expect(String(captured.url)).toBe("https://api.perplexity.ai/chat/completions");
    expect(captured.headers.get("authorization")).toBe("Bearer pplx-key");
    expect(captured.body.model).toBe("sonar");
    // Perplexity-only params spread through unchanged.
    expect(captured.body.search_recency_filter).toBe("month");
    expect(captured.body.return_related_questions).toBe(false);
    // Top-level citations flow through to ChatResponse.
    expect(res.choices?.[0]?.message?.content).toBe("answer");
    expect(res.citations).toEqual(["https://a.com", "https://b.com"]);
  });

  it("throws ChatHttpError carrying the status on a non-2xx", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("rate limited", { status: 429 })));
    await expect(provider.call({ messages: [{ role: "user", content: "hi" }] })).rejects.toMatchObject({
      status: 429,
      providerId: "perplexity",
    });
  });

  it("has no callStream (so the stream path falls back to call() and keeps citations)", () => {
    expect(provider.callStream).toBeUndefined();
  });
});

describe("resolveChatChain gating", () => {
  it("is DeepSeek-only when GEMINI_API_KEY is unset", () => {
    vi.stubEnv("DEEPSEEK_API_KEY", "ds-key");
    vi.stubEnv("GEMINI_API_KEY", "");
    const chain = resolveChatChain();
    expect(chain.map((p) => p.id)).toEqual(["deepseek"]);
  });

  it("appends Gemini as fallback when GEMINI_API_KEY is set", () => {
    vi.stubEnv("DEEPSEEK_API_KEY", "ds-key");
    vi.stubEnv("GEMINI_API_KEY", "gem-key");
    const chain = resolveChatChain();
    expect(chain.map((p) => p.id)).toEqual(["deepseek", "gemini"]);
  });
});

describe("callChatStreamWithFailover", () => {
  const req = { messages: [{ role: "user" as const, content: "hi" }] };

  /** Streaming provider: emits the given chunks via onDelta, then resolves. */
  function streamProvider(id: string, chunks: string[]): ChatProvider {
    return {
      id,
      call: vi.fn(async () => ok(chunks.join(""))),
      callStream: vi.fn(async (_req, onDelta) => {
        for (const c of chunks) onDelta(c);
        return ok(chunks.join(""));
      }),
    };
  }

  it("streams deltas token-by-token from the primary", async () => {
    const deltas: string[] = [];
    const primary = streamProvider("deepseek", ["He", "llo", "!"]);
    const { response, providerId } = await callChatStreamWithFailover(
      [primary],
      req,
      (d) => deltas.push(d),
    );
    expect(deltas).toEqual(["He", "llo", "!"]);
    expect(providerId).toBe("deepseek");
    expect(response.choices?.[0]?.message?.content).toBe("Hello!");
  });

  it("fails over BEFORE the first token (primary 402 → fallback)", async () => {
    const deltas: string[] = [];
    const primary: ChatProvider = {
      id: "deepseek",
      call: vi.fn(),
      callStream: vi.fn(async () => {
        throw new ChatHttpError("deepseek", 402, "Insufficient Balance");
      }),
    };
    const fallback = streamProvider("gemini-stream", ["from ", "fallback"]);
    const { providerId } = await callChatStreamWithFailover([primary, fallback], req, (d) =>
      deltas.push(d),
    );
    expect(providerId).toBe("gemini-stream");
    expect(deltas.join("")).toBe("from fallback");
  });

  it("does NOT fail over once a token has been emitted (commit to primary)", async () => {
    const deltas: string[] = [];
    const primary: ChatProvider = {
      id: "deepseek",
      call: vi.fn(),
      callStream: vi.fn(async (_req, onDelta) => {
        onDelta("partial");
        throw new ChatHttpError("deepseek", 500, "mid-stream boom");
      }),
    };
    const fallback = streamProvider("gemini", ["should not run"]);
    await expect(
      callChatStreamWithFailover([primary, fallback], req, (d) => deltas.push(d)),
    ).rejects.toMatchObject({ status: 500 });
    expect(deltas).toEqual(["partial"]); // fallback never streamed
    expect(fallback.callStream).not.toHaveBeenCalled();
  });

  it("uses a non-streaming fallback by emitting its whole content as one delta", async () => {
    const deltas: string[] = [];
    const primary: ChatProvider = {
      id: "deepseek",
      call: vi.fn(),
      callStream: vi.fn(async () => {
        throw new ChatHttpError("deepseek", 402, "");
      }),
    };
    // Gemini-style: no callStream → falls back to call()
    const fallback = fakeProvider("gemini", async () => ok("whole answer"));
    const { providerId } = await callChatStreamWithFailover([primary, fallback], req, (d) =>
      deltas.push(d),
    );
    expect(providerId).toBe("gemini");
    expect(deltas).toEqual(["whole answer"]); // single delta
  });
});
