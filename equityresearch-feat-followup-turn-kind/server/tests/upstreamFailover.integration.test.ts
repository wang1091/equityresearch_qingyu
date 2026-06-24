// Integration test for the upstream failover requirement:
// "if the internal localhost service is down, fall over to the (public) URL".
// Unlike upstreamFetch.test.ts (mocked fetch), this drives the REAL
// fetchJsonWithFallback over REAL local HTTP servers + real network, so it
// exercises connection-refused → failover, the createRequestJson transport,
// and the UpstreamFallbackError contract end to end.
import { afterEach, describe, expect, it } from "vitest";
import http from "node:http";
import { fetchJsonWithFallback, UpstreamFallbackError } from "../upstreamFetch";
import { __resetHttpClientStateForTests } from "../../http/httpClient";

type Stub = { server: http.Server; port: number; hits: number };

/** Start a real HTTP server on an ephemeral port with the given JSON responder. */
function startStub(
  respond: (req: http.IncomingMessage) => { status: number; body: unknown },
): Promise<Stub> {
  return new Promise((resolve) => {
    const stub: Partial<Stub> & { hits: number } = { hits: 0 };
    const server = http.createServer((req, res) => {
      stub.hits++;
      const { status, body } = respond(req);
      res.writeHead(status, { "Content-Type": "application/json" });
      res.end(JSON.stringify(body));
    });
    server.listen(0, "127.0.0.1", () => {
      stub.server = server;
      stub.port = (server.address() as { port: number }).port;
      resolve(stub as Stub);
    });
  });
}

/** A port with nothing listening → connect yields ECONNREFUSED ("down"). */
function deadPort(): Promise<number> {
  return new Promise((resolve) => {
    const s = http.createServer();
    s.listen(0, "127.0.0.1", () => {
      const port = (s.address() as { port: number }).port;
      s.close(() => resolve(port));
    });
  });
}

const openStubs: http.Server[] = [];
afterEach(() => {
  openStubs.splice(0).forEach((s) => s.close());
  __resetHttpClientStateForTests();
});

function track(stub: Stub) {
  openStubs.push(stub.server);
  return stub;
}

/** Attempts list shaped like apiCaller's NEWS/VALUATION: [internal, public]. */
function attempts(internalBase: string, publicBase: string) {
  return [internalBase, publicBase].map((base) => ({
    url: `${base}/api/full-valuation`,
    init: {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ticker: "TEST" }),
    },
    parse: (raw: unknown) => raw,
  }));
}

const opts = {
  timeoutMs: 3000,
  label: "VALUATION[TEST]",
  errorTag: "VALUATION_TEST",
  maxRetries: 0,
  circuitBreaker: false,
};

describe("upstream failover: internal localhost down → public URL", () => {
  it("uses the internal service when it is healthy (never hits the public URL)", async () => {
    const internal = track(await startStub(() => ({ status: 200, body: { via: "internal" } })));
    const pub = track(await startStub(() => ({ status: 200, body: { via: "public" } })));

    const out = await fetchJsonWithFallback(
      attempts(`http://127.0.0.1:${internal.port}`, `http://127.0.0.1:${pub.port}`),
      opts,
    );

    expect((out as any).via).toBe("internal");
    expect(internal.hits).toBe(1);
    expect(pub.hits).toBe(0); // public URL untouched while internal is healthy
  });

  it("fails over to the public URL when the internal service returns 5xx", async () => {
    const internal = track(await startStub(() => ({ status: 503, body: { error: "unavailable" } })));
    const pub = track(await startStub(() => ({ status: 200, body: { via: "public" } })));

    const out = await fetchJsonWithFallback(
      attempts(`http://127.0.0.1:${internal.port}`, `http://127.0.0.1:${pub.port}`),
      opts,
    );

    expect((out as any).via).toBe("public");
    expect(internal.hits).toBe(1); // maxRetries:0 → tried once, then failover
    expect(pub.hits).toBe(1);
  });

  it("fails over to the public URL when the internal service is DOWN (connection refused)", async () => {
    const dead = await deadPort();
    const pub = track(await startStub(() => ({ status: 200, body: { via: "public" } })));

    const out = await fetchJsonWithFallback(
      attempts(`http://127.0.0.1:${dead}`, `http://127.0.0.1:${pub.port}`),
      opts,
    );

    expect((out as any).via).toBe("public");
    expect(pub.hits).toBe(1);
  });

  it("throws UpstreamFallbackError carrying both attempts when internal and public are both down", async () => {
    const dead1 = await deadPort();
    const dead2 = await deadPort();

    const err = await fetchJsonWithFallback(
      attempts(`http://127.0.0.1:${dead1}`, `http://127.0.0.1:${dead2}`),
      opts,
    ).catch((e) => e);

    expect(err).toBeInstanceOf(UpstreamFallbackError);
    expect((err as UpstreamFallbackError).errors).toHaveLength(2);
  });
});
