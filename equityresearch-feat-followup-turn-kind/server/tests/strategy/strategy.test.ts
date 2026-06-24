// Foundation tests for the strategy/ module: the plan runner (HTTP via the
// shared hardened transport, local via value/thunk) and the source-catalog
// drift guard (shared SUPPORTED_DATA_SOURCES must match server VALID_DATA_SOURCES).
import { describe, it, expect, afterEach, vi } from "vitest";
import { runPlan } from "../../../strategy/runner";
import { createJsonPostPlan, createLocalPlan, BASE_POLICY } from "../../../strategy/common";
import { __resetHttpClientStateForTests } from "../../../http/httpClient";
import { SUPPORTED_DATA_SOURCES, SOURCE_TIMEOUT_MS } from "../../../shared/sourceCatalog";
import { VALID_DATA_SOURCES } from "../../agent/intentSources";

afterEach(() => {
  vi.unstubAllGlobals();
  __resetHttpClientStateForTests();
});

function stubFetch(impl: (url: string, init?: any) => Promise<Response>) {
  const fn = vi.fn(impl);
  vi.stubGlobal("fetch", fn);
  return fn;
}

describe("runPlan — HTTP plan", () => {
  it("executes through the shared transport and returns the parsed JSON", async () => {
    const fetchMock = stubFetch(async () =>
      new Response(JSON.stringify({ ok: true, n: 42 }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    const plan = createJsonPostPlan(
      "https://example.test/api/thing",
      "thing",
      { q: "hi" },
      { ...BASE_POLICY, timeoutMs: 5_000 },
    );
    const result = await runPlan<{ ok: boolean; n: number }>(plan);

    expect(result).toEqual({ ok: true, n: 42 });
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe("https://example.test/api/thing");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual({ q: "hi" });
  });

  it("surfaces an HTTP error from the transport (non-2xx → throws)", async () => {
    stubFetch(async () => new Response("boom", { status: 500 }));
    const plan = createJsonPostPlan(
      "https://example.test/api/thing",
      "thing",
      {},
      { ...BASE_POLICY, maxRetries: 0, timeoutMs: 5_000 },
    );
    await expect(runPlan(plan)).rejects.toMatchObject({ status: 500 });
  });
});

describe("runPlan — local plan", () => {
  it("returns a static value without any fetch", async () => {
    const fetchMock = stubFetch(async () => new Response("{}", { status: 200 }));
    const result = await runPlan(createLocalPlan({ type: "general", hello: "world" }));
    expect(result).toEqual({ type: "general", hello: "world" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("resolves a thunk (sync or async)", async () => {
    expect(await runPlan(createLocalPlan(() => 7))).toBe(7);
    expect(await runPlan(createLocalPlan(async () => "later"))).toBe("later");
  });
});

describe("source catalog — single source of truth", () => {
  it("intentSources re-exports the SAME array (no second copy)", () => {
    // Referential identity: if someone reintroduces a separate VALID_DATA_SOURCES
    // literal in intentSources.ts, this fails.
    expect(VALID_DATA_SOURCES).toBe(SUPPORTED_DATA_SOURCES);
  });

  it("every supported source has a positive default timeout", () => {
    for (const src of SUPPORTED_DATA_SOURCES) {
      expect(SOURCE_TIMEOUT_MS[src]).toBeGreaterThan(0);
    }
  });
});
