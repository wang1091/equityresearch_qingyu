// Unit tests for the table-driven upstream resolver (server/upstreamConfig.ts).
// The getters/resolvers accept an explicit env, so these are deterministic with
// no global stubbing.
import { describe, it, expect } from "vitest";
import {
  resolveUpstreamBases,
  resolveUpstreamPrimary,
  getNewsApiBase,
  getSmartnewsApiBase,
  getValuationApiBase,
  getValuationFallbackBase,
  getStockPickerApiBase,
  getPerformanceApiBase,
  getFdaApiBase,
  getRumorApiBase,
} from "../upstreamConfig";

const env = (o: Record<string, string>) => o as NodeJS.ProcessEnv;

describe("resolveUpstreamBases (failover assembly)", () => {
  it("local primary on a failover source → [local, public]", () => {
    expect(resolveUpstreamBases("VALUATION", env({}))).toEqual([
      "http://localhost:8503",
      "https://valuation.checkitanalytics.com",
    ]);
    expect(
      resolveUpstreamBases("NEWS", env({ NEWS_API_BASE_URL: "http://127.0.0.1:5000" })),
    ).toEqual(["http://127.0.0.1:5000", "https://smartnews.checkitanalytics.com"]);
  });

  it("public primary on a failover source → [public] only (nothing to fail over to)", () => {
    expect(
      resolveUpstreamBases("VALUATION", env({ VALUATION_API_URL: "https://valuation.checkitanalytics.com" })),
    ).toEqual(["https://valuation.checkitanalytics.com"]);
  });

  it("non-failover source → single base", () => {
    expect(resolveUpstreamBases("COMPETITIVE", env({}))).toEqual(["http://localhost:8081"]);
  });

  it("migrated sources: local primary → [local, public] (STOCK_PICKER/TRENDING/FDA/PERFORMANCE)", () => {
    expect(resolveUpstreamBases("STOCK_PICKER", env({}))).toEqual([
      "http://127.0.0.1:5656",
      "https://stockpick.checkitanalytics.com",
    ]);
    expect(resolveUpstreamBases("TRENDING", env({}))).toEqual([
      "http://localhost:5656",
      "https://stockpick.checkitanalytics.com",
    ]);
    expect(resolveUpstreamBases("FDA", env({}))).toEqual([
      "http://127.0.0.1:5002",
      "https://fdacalendar.checkitanalytics.com",
    ]);
    expect(resolveUpstreamBases("PERFORMANCE", env({}))).toEqual([
      "http://localhost:8502",
      "https://keymetrics.checkitanalytics.com",
    ]);
  });

  it("migrated sources: a public env override → [public] only (nothing to fail over to)", () => {
    expect(
      resolveUpstreamBases("FDA", env({ FDA_API_BASE_URL: "https://fdacalendar.checkitanalytics.com" })),
    ).toEqual(["https://fdacalendar.checkitanalytics.com"]);
    expect(
      resolveUpstreamBases("PERFORMANCE", env({
        PERFORMANCE_API_URL: "http://127.0.0.1:9001",
        PERFORMANCE_FALLBACK_URL: "https://km.example.com",
      })),
    ).toEqual(["http://127.0.0.1:9001", "https://km.example.com"]);
  });

  it("env override is honored and the fallback is env-tunable", () => {
    expect(
      resolveUpstreamBases("VALUATION", env({
        VALUATION_API_URL: "http://127.0.0.1:9999",
        VALUATION_FALLBACK_URL: "https://vfallback.example.com",
      })),
    ).toEqual(["http://127.0.0.1:9999", "https://vfallback.example.com"]);
  });
});

describe("getter behavior parity (defaults preserved)", () => {
  it("static defaults match the pre-refactor values", () => {
    expect(getValuationApiBase(env({}))).toBe("http://localhost:8503");
    expect(getSmartnewsApiBase(env({}))).toBe("https://smartnews.checkitanalytics.com");
    expect(getValuationFallbackBase(env({}))).toBe("https://valuation.checkitanalytics.com");
    expect(getPerformanceApiBase(env({}))).toBe("http://localhost:8502");
    // STOCK_PICKER / FDA defaults flipped to LOCAL (base = local, failsafe = public).
    expect(getStockPickerApiBase(env({}))).toBe("http://127.0.0.1:5656");
    expect(getFdaApiBase(env({}))).toBe("http://127.0.0.1:5002");
    expect(getRumorApiBase(env({}))).toBe("http://localhost:3000");
  });

  it("NEWS: prod default is public; NEWS_API_BASE_URL beats API_BASE_URL", () => {
    expect(getNewsApiBase(env({ NODE_ENV: "production" }))).toBe(
      "https://smartnews.checkitanalytics.com",
    );
    expect(getNewsApiBase(env({ API_BASE_URL: "http://b" }))).toBe("http://b");
    expect(getNewsApiBase(env({ NEWS_API_BASE_URL: "http://a", API_BASE_URL: "http://b" }))).toBe(
      "http://a",
    );
  });

  it("normalizes a trailing slash", () => {
    expect(resolveUpstreamPrimary("VALUATION", env({ VALUATION_API_URL: "http://x:1/" }))).toBe(
      "http://x:1",
    );
  });
});
