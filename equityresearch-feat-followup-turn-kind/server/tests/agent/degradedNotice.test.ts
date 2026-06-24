// The degraded banner must distinguish "no data for this ticker" (retry won't
// help — a micro-cap with no financials) from "slow/unreachable upstream" (retry
// may help). Both used to collapse into one "retry shortly" line, which lied to
// the user when the data simply doesn't exist. See generator.buildDegradedNotice.
import { describe, it, expect } from "vitest";
import { buildDegradedNotice } from "../../agent/generator";

describe("buildDegradedNotice", () => {
  it("returns undefined when every requested source produced data", () => {
    const apiData = { STOCK_PRICE: { price: 21.24 } };
    expect(buildDegradedNotice(apiData, { STOCK_PRICE: {} }, "en")).toBeUndefined();
  });

  it("labels a no-data 5xx as unavailable, not retryable (valuation micro-cap)", () => {
    // The exact shape apiCaller.foldBySource writes for a failed source.
    const apiData = {
      VALUATION: { error: 'HTTP 500 - {"detail":"No quarterly income statement data available."}' },
    };
    const en = buildDegradedNotice(apiData, {}, "en")!;
    expect(en).toContain("No data available (valuation)");
    expect(en).toContain("retrying won't help");
    expect(en).not.toContain("please retry shortly");

    const zh = buildDegradedNotice(apiData, {}, "zh")!;
    expect(zh).toContain("暂无相关数据（valuation）");
    expect(zh).toContain("重试通常无效");
  });

  it("labels a timeout / all-bases-down as retryable", () => {
    const apiData = { STOCK_PICKER: { error: "STOCK_PICKER: no usable upstream response" } };
    const en = buildDegradedNotice(apiData, {}, "en")!;
    expect(en).toContain("Couldn't retrieve live data right now (stock picker)");
    expect(en).toContain("please retry shortly");

    const zh = buildDegradedNotice(apiData, {}, "zh")!;
    expect(zh).toContain("实时数据暂时未能获取（stock picker）");
    expect(zh).toContain("建议稍后重试");
  });

  it("keeps a transient 5xx (no no-data detail) retryable", () => {
    const apiData = { NEWS: { error: "HTTP 503 - service temporarily unavailable" } };
    expect(buildDegradedNotice(apiData, {}, "en")!).toContain("please retry shortly");
  });

  it("emits both clauses when a mix of failures occurs", () => {
    const apiData = {
      VALUATION: { error: "HTTP 404 - ticker not found" },
      STOCK_PICKER: { error: "TimeoutError: upstream timed out" },
    };
    const en = buildDegradedNotice(apiData, {}, "en")!;
    expect(en).toContain("No data available (valuation)");
    expect(en).toContain("Couldn't retrieve live data right now (stock picker)");
  });
});
