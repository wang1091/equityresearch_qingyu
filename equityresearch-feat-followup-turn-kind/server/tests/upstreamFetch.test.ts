import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchJsonWithFallback, UpstreamFallbackError } from "../upstreamFetch";
import { logger } from "../utils";
import { __resetHttpClientStateForTests } from "../../http/httpClient";

const res = (status: number, body: string): Response =>
  ({
    ok: status >= 200 && status < 300,
    status,
    statusText: `HTTP ${status}`,
    headers: new Headers(),
    text: async () => body,
  }) as unknown as Response;

// Failover-semantics tests isolate themselves from the new retry + circuit
// behavior (covered separately below) so call counts reflect pure failover.
const sharedOpts = {
  timeoutMs: 1000,
  label: "TEST",
  errorTag: "TEST",
  maxRetries: 0,
  circuitBreaker: false,
};

// Build attempts that share one init (the NEWS/VALUATION shape). `parse` now
// receives the already-parsed JSON, not raw text.
const jsonAttempts = (...urls: string[]) =>
  urls.map((url) => ({ url, init: { method: "POST" }, parse: (raw: unknown) => raw }));

afterEach(() => {
  vi.restoreAllMocks();
  __resetHttpClientStateForTests();
});

describe("fetchJsonWithFallback", () => {
  it("returns the first attempt's parsed body and does not try the second", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(res(200, '{"v":1}'));
    vi.stubGlobal("fetch", fetchMock);

    const out = await fetchJsonWithFallback(jsonAttempts("http://a", "http://b"), sharedOpts);

    expect(out).toEqual({ v: 1 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe("http://a");
  });

  it("falls back to the second attempt when the first is not HTTP-ok", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(res(502, "bad gateway"))
      .mockResolvedValueOnce(res(200, '{"v":2}'));
    vi.stubGlobal("fetch", fetchMock);

    const out = await fetchJsonWithFallback(jsonAttempts("http://a", "http://b"), sharedOpts);

    expect(out).toEqual({ v: 2 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("emits explicit upstream.failover + upstream.failover.recovered events on a cross-URL fallback", async () => {
    const warn = vi.spyOn(logger, "warn");
    const info = vi.spyOn(logger, "info");
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(res(502, "bad gateway"))
      .mockResolvedValueOnce(res(200, '{"v":2}'));
    vi.stubGlobal("fetch", fetchMock);

    await fetchJsonWithFallback(jsonAttempts("http://a", "http://b"), sharedOpts);

    // explicit "switched from A to B" transition (one greppable line)
    expect(warn).toHaveBeenCalledWith(
      "upstream.failover",
      expect.objectContaining({ source: "TEST", from: "http://a", to: "http://b" }),
    );
    // explicit recovery once B succeeds
    expect(info).toHaveBeenCalledWith(
      "upstream.failover.recovered",
      expect.objectContaining({ url: "http://b", afterFailures: 1 }),
    );
  });

  it("does NOT emit upstream.failover when the first attempt succeeds", async () => {
    const warn = vi.spyOn(logger, "warn");
    const fetchMock = vi.fn().mockResolvedValueOnce(res(200, '{"v":1}'));
    vi.stubGlobal("fetch", fetchMock);

    await fetchJsonWithFallback(jsonAttempts("http://a", "http://b"), sharedOpts);

    expect(warn).not.toHaveBeenCalledWith("upstream.failover", expect.anything());
  });

  it("falls back when the first body fails to parse", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(res(200, "<html>not json</html>"))
      .mockResolvedValueOnce(res(200, '{"v":3}'));
    vi.stubGlobal("fetch", fetchMock);

    const out = await fetchJsonWithFallback(jsonAttempts("http://a", "http://b"), sharedOpts);

    expect(out).toEqual({ v: 3 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("treats a parse that throws (e.g. success:false) as a failed attempt", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(res(200, '{"success":false,"error":"not ready"}'))
      .mockResolvedValueOnce(res(200, '{"ok":true}'));
    vi.stubGlobal("fetch", fetchMock);

    const out = await fetchJsonWithFallback(
      [
        {
          url: "http://primary",
          init: { method: "POST" },
          parse: (raw: unknown) => {
            const d = raw as any;
            if (d.success === false) throw new Error(d.error);
            return d;
          },
        },
        { url: "http://fallback", init: { method: "POST" }, parse: (raw: unknown) => raw },
      ],
      sharedOpts,
    );

    expect(out).toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("supports per-attempt init (different body) and async parse", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(res(500, "boom"))
      .mockResolvedValueOnce(res(200, '{"raw":true}'));
    vi.stubGlobal("fetch", fetchMock);

    const out = await fetchJsonWithFallback(
      [
        { url: "http://a", init: { method: "POST", body: "A" }, parse: (raw: unknown) => raw },
        {
          url: "http://b",
          init: { method: "POST", body: "B" },
          parse: async (raw: unknown) => ({ wrapped: (raw as any).raw }),
        },
      ],
      sharedOpts,
    );

    expect(out).toEqual({ wrapped: true });
    expect(fetchMock.mock.calls[1][1]).toMatchObject({ body: "B" });
  });

  it("throws UpstreamFallbackError carrying every attempt's error", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(res(500, "boom"))
      .mockRejectedValueOnce(new Error("ECONNREFUSED"));
    vi.stubGlobal("fetch", fetchMock);

    const err = await fetchJsonWithFallback(jsonAttempts("http://a", "http://b"), sharedOpts).catch(
      (e) => e as UpstreamFallbackError,
    );

    expect(err).toBeInstanceOf(UpstreamFallbackError);
    expect(err.name).toBe("UpstreamFallbackError");
    expect(err.message).toBe("ECONNREFUSED"); // last attempt's error
    expect(err.errors).toHaveLength(2);
    expect(err.errors[0]).toMatchObject({ url: "http://a" });
    expect(err.errors[0].message).toMatch(/HTTP 500/); // ApiRequestError message
    expect(err.errors[1]).toMatchObject({ url: "http://b", message: "ECONNREFUSED" });
  });

  it("retries a transient 5xx within the same attempt before failing over", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(res(503, "unavailable"))
      .mockResolvedValueOnce(res(200, '{"v":9}'));
    vi.stubGlobal("fetch", fetchMock);

    const out = await fetchJsonWithFallback(jsonAttempts("http://a", "http://b"), {
      ...sharedOpts,
      maxRetries: 1,
      retryDelayMs: 0,
    });

    expect(out).toEqual({ v: 9 });
    // Both calls hit the SAME first URL — a retry, not a failover.
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0][0]).toBe("http://a");
    expect(fetchMock.mock.calls[1][0]).toBe("http://a");
  });

  it("opens the circuit after repeated failures and then fails fast (no fetch)", async () => {
    const fetchMock = vi.fn().mockResolvedValue(res(500, "boom"));
    vi.stubGlobal("fetch", fetchMock);

    const opts = {
      ...sharedOpts,
      maxRetries: 0,
      circuitBreaker: true,
      circuitFailureThreshold: 2,
      circuitOpenMs: 10_000,
    };
    const oneAttempt = () => fetchJsonWithFallback(jsonAttempts("http://a"), opts);

    await oneAttempt().catch(() => {}); // failure 1
    await oneAttempt().catch(() => {}); // failure 2 → circuit opens for TEST:a
    await oneAttempt().catch(() => {}); // circuit open → no fetch

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
