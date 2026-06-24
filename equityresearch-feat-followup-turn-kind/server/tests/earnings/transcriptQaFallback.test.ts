// Behavior net for the Perplexity fallback path of transcriptQaWithFallback
// (server/earnings/transcriptQaFallback.ts). Pins the P2 consolidation onto the
// shared LLM layer (server/llm/chat.ts): the transcript step is mocked to force
// the fallback, and global fetch is stubbed for the Perplexity call to assert
// success shape + citation mapping and the HTTP-error → TranscriptQaError mapping.
import { describe, it, expect, afterEach, vi } from "vitest";

// Mock the transcript client so we control whether step 1 hits or 404s.
const callExternalTranscriptQa = vi.fn();
vi.mock("../../earnings/transcriptQaClient", () => ({
  callExternalTranscriptQa: (...args: unknown[]) => callExternalTranscriptQa(...args),
  ExternalTranscriptQaClientError: class extends Error {
    status: number;
    code?: string;
    constructor(status: number, message: string, code?: string) {
      super(message);
      this.status = status;
      this.code = code;
    }
  },
}));

import { transcriptQaWithFallback, TranscriptQaError } from "../../earnings/transcriptQaFallback";
import { ExternalTranscriptQaClientError } from "../../earnings/transcriptQaClient";

afterEach(() => {
  vi.unstubAllGlobals();
  callExternalTranscriptQa.mockReset();
});

const baseInput = {
  ticker: "AAPL",
  year: 2025,
  quarter: 2,
  question: "What was guidance?",
  apiBase: "http://localhost:5000",
  perplexityKey: "pplx-key",
};

function stubFetch(impl: (url: string, init?: any) => Promise<Response>) {
  const fn = vi.fn(impl);
  vi.stubGlobal("fetch", fn);
  return fn;
}

describe("transcriptQaWithFallback — Perplexity fallback (P2)", () => {
  it("falls over to Perplexity on transcript 404 and maps the answer + citations", async () => {
    callExternalTranscriptQa.mockRejectedValueOnce(
      new ExternalTranscriptQaClientError(404, "not found"),
    );
    const fetchMock = stubFetch(async () =>
      new Response(
        JSON.stringify({
          choices: [{ message: { content: "Guidance was raised." } }],
          citations: ["https://src.com/a", { id: 7, quote: "preformed" }],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );

    const result = await transcriptQaWithFallback(baseInput);

    expect(String(fetchMock.mock.calls[0][0])).toContain("api.perplexity.ai/chat/completions");
    expect(result.source).toBe("perplexity_fallback");
    expect(result.fallbackReason).toBe("transcript_not_found");
    expect(result.answer).toBe("Guidance was raised.");
    expect(result.hasAnswer).toBe(true);
    // String citations become {id, quote}; pre-formed objects pass through.
    expect(result.citations).toEqual([
      { id: 1, quote: "https://src.com/a" },
      { id: 7, quote: "preformed" },
    ]);
  });

  it("maps a Perplexity 5xx to a TranscriptQaError(502, code perplexity_503)", async () => {
    callExternalTranscriptQa.mockRejectedValueOnce(
      new ExternalTranscriptQaClientError(404, "not found"),
    );
    stubFetch(async () => new Response("upstream down", { status: 503 }));

    const err = await transcriptQaWithFallback(baseInput).catch((e) => e);
    expect(err).toBeInstanceOf(TranscriptQaError);
    expect(err).toMatchObject({ status: 502, code: "perplexity_503" });
  });

  it("returns the transcript answer without calling Perplexity when step 1 hits", async () => {
    callExternalTranscriptQa.mockResolvedValueOnce({
      answer: "From transcript.",
      question: baseInput.question,
      hasAnswer: true,
      highlightPhrases: [],
      citations: [],
      references: [],
      thinking: "",
      ticker: baseInput.ticker,
      year: baseInput.year,
      quarter: baseInput.quarter,
    });
    const fetchMock = stubFetch(async () => new Response("{}", { status: 200 }));

    const result = await transcriptQaWithFallback(baseInput);

    expect(result.source).toBe("transcript");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("404s without a perplexityKey instead of calling out", async () => {
    callExternalTranscriptQa.mockRejectedValueOnce(
      new ExternalTranscriptQaClientError(404, "not found"),
    );
    const fetchMock = stubFetch(async () => new Response("{}", { status: 200 }));

    await expect(
      transcriptQaWithFallback({ ...baseInput, perplexityKey: undefined }),
    ).rejects.toMatchObject({ status: 404, code: "transcript_not_found" });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
