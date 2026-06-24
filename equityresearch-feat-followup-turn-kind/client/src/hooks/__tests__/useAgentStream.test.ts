import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { consumeAgentStream, type AgentStreamEvent } from "../useAgentStream";

// --- helpers -------------------------------------------------------------

/** Build a ReadableStream that emits the given string chunks as UTF-8 bytes. */
function streamOf(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
}

/** A fetch impl that resolves to a 200 streaming Response made of `chunks`. */
function fetchStreaming(chunks: string[]): typeof fetch {
  return (async () => new Response(streamOf(chunks), { status: 200 })) as unknown as typeof fetch;
}

/** Serialize an event the way the server does: one `data: <json>\n` SSE line. */
function frame(obj: unknown): string {
  return `data: ${JSON.stringify(obj)}\n`;
}

const REQUEST = { conversationId: "c1", message: "hi", language: "en" as const };
const SIGNAL = new AbortController().signal;

/** Collect every event consumeAgentStream emits for the given raw chunks. */
async function collect(chunks: string[]): Promise<AgentStreamEvent[]> {
  const events: AgentStreamEvent[] = [];
  await consumeAgentStream(REQUEST, (e) => events.push(e), SIGNAL, fetchStreaming(chunks));
  return events;
}

// --- tests ---------------------------------------------------------------

describe("consumeAgentStream", () => {
  beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("parses a sequence of frames in order", async () => {
    const events = await collect([
      frame({ type: "classification", required_data: ["NEWS"], tickers: ["AAPL"] }),
      frame({ type: "content", chunk: "Hello " }),
      frame({ type: "content", chunk: "world" }),
      frame({ type: "done", metadata: { requiredData: ["NEWS"] } }),
    ]);

    expect(events.map((e) => e.type)).toEqual([
      "classification",
      "content",
      "content",
      "done",
    ]);
  });

  it("reassembles a single frame split across two stream reads (the buffer命门)", async () => {
    const whole = frame({ type: "content", chunk: "spanning chunks" });
    const mid = Math.floor(whole.length / 2);
    // Split the one `data:` line into two arbitrary byte chunks.
    const events = await collect([whole.slice(0, mid), whole.slice(mid)]);

    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({ type: "content", chunk: "spanning chunks" });
  });

  it("handles multiple frames packed into one read, and a frame split across the boundary", async () => {
    const a = frame({ type: "content", chunk: "a" });
    const b = frame({ type: "content", chunk: "b" });
    const c = frame({ type: "done" });
    // Read 1 = a + first half of b; Read 2 = rest of b + c.
    const bMid = a.length + Math.floor(b.length / 2);
    const combined = a + b + c;
    const events = await collect([combined.slice(0, bMid), combined.slice(bMid)]);

    expect(events.map((e) => (e.type === "content" ? e.chunk : e.type))).toEqual([
      "a",
      "b",
      "done",
    ]);
  });

  it("ignores blank lines and non-`data:` lines", async () => {
    const events = await collect([
      "\n",
      ": keep-alive comment\n",
      "event: ping\n",
      frame({ type: "content", chunk: "x" }),
    ]);

    expect(events).toEqual([{ type: "content", chunk: "x" }]);
  });

  it("swallows a malformed JSON line (warns) and keeps parsing later frames", async () => {
    const events = await collect([
      "data: {not valid json}\n",
      frame({ type: "content", chunk: "after" }),
    ]);

    expect(console.warn).toHaveBeenCalled();
    expect(events).toEqual([{ type: "content", chunk: "after" }]);
  });

  it("drops an un-terminated trailing frame (no final newline)", async () => {
    // The loop only flushes complete lines; a frame with no trailing "\n" stays
    // in `buffer` and is never emitted when the stream closes. The server always
    // newline-terminates frames, so this pins current behavior — if we ever add
    // a flush-on-done, this test should change deliberately.
    const events = await collect([
      frame({ type: "content", chunk: "kept" }),
      `data: ${JSON.stringify({ type: "done" })}`, // no trailing \n
    ]);

    expect(events).toEqual([{ type: "content", chunk: "kept" }]);
  });

  it("does not reject when onEvent throws (error-frame swallow is preserved)", async () => {
    // The inline loop used to `throw` on an `error` frame, only to have the
    // per-line catch swallow + log it. The reducer keeps throwing; this asserts
    // the throw never surfaces as a rejected run.
    const events: AgentStreamEvent[] = [];
    await expect(
      consumeAgentStream(
        REQUEST,
        (e) => {
          events.push(e);
          if (e.type === "error") throw new Error("boom from reducer");
        },
        SIGNAL,
        fetchStreaming([
          frame({ type: "error", error: "stream blew up" }),
          frame({ type: "content", chunk: "still flowing" }),
        ]),
      ),
    ).resolves.toBeUndefined();

    expect(console.warn).toHaveBeenCalled();
    // Parsing continues past the throwing frame.
    expect(events.map((e) => e.type)).toEqual(["error", "content"]);
  });

  it("rejects with a status message when the response is not ok", async () => {
    const notOk = (async () =>
      new Response("upstream exploded", { status: 500, statusText: "Server Error" })) as unknown as typeof fetch;

    await expect(
      consumeAgentStream(REQUEST, () => {}, SIGNAL, notOk),
    ).rejects.toThrow(/500/);
  });

  it("rejects when the response has no body", async () => {
    const noBody = (async () => new Response(null, { status: 200 })) as unknown as typeof fetch;

    await expect(
      consumeAgentStream(REQUEST, () => {}, SIGNAL, noBody),
    ).rejects.toThrow("响应体为空");
  });
});
