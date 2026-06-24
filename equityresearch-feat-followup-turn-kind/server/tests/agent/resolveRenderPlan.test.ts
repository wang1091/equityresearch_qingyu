// Pins resolveRenderPlan() — the post-fetch render decision lifted out of the chatStream
// direct-card block (PLAN_CONSOLIDATION_PLAN.md Step 4). Pure over (plan, apiData, opts),
// so every branch + edge (gate, api-failure short-circuit, sink absence, precedence) is
// asserted without the streaming IO. Behavior is byte-equivalent to the old conditionals.
import { describe, it, expect } from "vitest";
import { resolveRenderPlan } from "../../agent/resolveRenderPlan";
import type { ResolvedPlan, PlanGuards } from "../../agent/resolvePlan";

const baseGuards: PlanGuards = {
  isSetScreen: false,
  isComparison: false,
  isMultiTicker: false,
  isSingleIntent: true,
  isRumorOnly: false,
};

// Minimal single-intent plan for `source`. Override guards as needed.
function plan(source: string, guards: Partial<PlanGuards> = {}): ResolvedPlan {
  return {
    answerMode: "SIMPLE",
    answerIntent: "explainer",
    entities: [],
    needApi: true,
    fetch: [{ source, params: {} }],
    guards: { ...baseGuards, ...guards },
  };
}

const SINK = { hasStructuredSink: true, directCardEnabled: true };
const NO_SINK = { hasStructuredSink: false, directCardEnabled: true };

describe("resolveRenderPlan", () => {
  it("single NEWS + structured sink → news_v2", () => {
    const rp = resolveRenderPlan(plan("NEWS"), { NEWS: { summary: "x", articles: [{}] } }, SINK);
    expect(rp).toEqual({ kind: "news_v2", source: "NEWS" });
  });

  it("single NEWS WITHOUT sink → degrades to html_card (NEWS is card-supported)", () => {
    const rp = resolveRenderPlan(plan("NEWS"), { NEWS: { summary: "x", articles: [{}] } }, NO_SINK);
    expect(rp).toEqual({ kind: "html_card", source: "NEWS" });
  });

  it("COMPETITIVE success=true + sink → source_card (folded onto the generic channel)", () => {
    const rp = resolveRenderPlan(plan("COMPETITIVE"), { COMPETITIVE: { success: true } }, SINK);
    expect(rp).toEqual({ kind: "source_card", source: "COMPETITIVE" });
  });

  it("COMPETITIVE success=false → llm (api-failure short-circuit, no card)", () => {
    const rp = resolveRenderPlan(plan("COMPETITIVE"), { COMPETITIVE: { success: false } }, SINK);
    expect(rp).toEqual({ kind: "llm" });
  });

  it("COMPETITIVE WITHOUT sink → html_card (in DIRECT_CARD_SOURCES; unchanged by the fold)", () => {
    const rp = resolveRenderPlan(plan("COMPETITIVE"), { COMPETITIVE: { success: true } }, NO_SINK);
    expect(rp).toEqual({ kind: "html_card", source: "COMPETITIVE" });
  });

  it("single STOCK_PICKER (valid payload) + sink → source_card (folded onto the generic channel)", () => {
    const rp = resolveRenderPlan(plan("STOCK_PICKER"), { STOCK_PICKER: { results: [], labels: [] } }, SINK);
    expect(rp).toEqual({ kind: "source_card", source: "STOCK_PICKER" });
  });

  it("STOCK_PICKER with error → llm (api-failure short-circuit, no card)", () => {
    const rp = resolveRenderPlan(plan("STOCK_PICKER"), { STOCK_PICKER: { error: "bad" } }, SINK);
    expect(rp).toEqual({ kind: "llm" });
  });

  it("EARNINGS ask/transcript_qa → source_card (migrated; single synthesized answer bypasses the comparison gate)", () => {
    const rp = resolveRenderPlan(plan("EARNINGS"), { EARNINGS: { topic: "transcript_qa", answer: "…" } }, SINK);
    expect(rp).toEqual({ kind: "source_card", source: "EARNINGS" });
  });

  it("EARNINGS ask/transcript_qa WITHOUT sink → html_card (still card-supported)", () => {
    const rp = resolveRenderPlan(plan("EARNINGS"), { EARNINGS: { topic: "transcript_qa", answer: "…" } }, NO_SINK);
    expect(rp).toEqual({ kind: "html_card", source: "EARNINGS" });
  });

  it("TRENDING WITHOUT sink → html_card even when the payload looks like a failure (trendingBypass)", () => {
    // Bypass still applies with no structured sink; it just lands on the HTML card.
    const rp = resolveRenderPlan(plan("TRENDING"), { TRENDING: {} }, NO_SINK);
    expect(rp).toEqual({ kind: "html_card", source: "TRENDING" });
  });

  it("non-TRENDING api failure → llm (no direct card)", () => {
    // MARKET_DATA with an empty/failed payload → isDirectCardApiFailure → llm.
    const rp = resolveRenderPlan(plan("MARKET_DATA"), { MARKET_DATA: null }, SINK);
    expect(rp).toEqual({ kind: "llm" });
  });

  it("multi-intent (not single) → llm", () => {
    const p: ResolvedPlan = {
      ...plan("VALUATION"),
      fetch: [{ source: "VALUATION", params: {} }, { source: "NEWS", params: {} }],
      guards: { ...baseGuards, isSingleIntent: false },
    };
    expect(resolveRenderPlan(p, { VALUATION: { fairValue: 1 } }, SINK)).toEqual({ kind: "llm" });
  });

  it("comparison framing → llm (not eligible)", () => {
    const rp = resolveRenderPlan(
      plan("VALUATION", { isComparison: true, isMultiTicker: true }),
      { VALUATION: { fairValue: 1 } },
      SINK,
    );
    expect(rp).toEqual({ kind: "llm" });
  });

  it("multi-ticker (no comparison wording) → llm unless rumor-only", () => {
    expect(
      resolveRenderPlan(plan("VALUATION", { isMultiTicker: true }), { VALUATION: { fairValue: 1 } }, SINK),
    ).toEqual({ kind: "llm" });
    // RUMOR bypasses the multi-ticker guard.
    expect(
      resolveRenderPlan(
        plan("RUMOR", { isMultiTicker: true, isRumorOnly: true }),
        { RUMOR: { items: [{}] } },
        SINK,
      ).kind,
    ).not.toBe("llm");
  });

  it("ENABLE_DIRECT_CARD off → llm", () => {
    const rp = resolveRenderPlan(plan("NEWS"), { NEWS: { summary: "x" } }, {
      hasStructuredSink: true,
      directCardEnabled: false,
    });
    expect(rp).toEqual({ kind: "llm" });
  });

  it("no apiData → llm", () => {
    expect(resolveRenderPlan(plan("NEWS"), null, SINK)).toEqual({ kind: "llm" });
  });

  it("migrated RATING + structured sink → source_card (off the HTML path)", () => {
    const rp = resolveRenderPlan(plan("RATING"), { RATING: { success: true, ticker: "AAPL", rating: "BUY" } }, SINK);
    expect(rp).toEqual({ kind: "source_card", source: "RATING" });
  });

  it("RATING WITHOUT sink → degrades to html_card (still card-supported)", () => {
    const rp = resolveRenderPlan(plan("RATING"), { RATING: { success: true, ticker: "AAPL", rating: "BUY" } }, NO_SINK);
    expect(rp).toEqual({ kind: "html_card", source: "RATING" });
  });

  it("migrated STOCK_PRICE + structured sink → source_card (off the HTML path)", () => {
    const rp = resolveRenderPlan(
      plan("STOCK_PRICE"),
      { STOCK_PRICE: { success: true, ticker: "AAPL", currentPrice: { price: 200 } } },
      SINK,
    );
    expect(rp).toEqual({ kind: "source_card", source: "STOCK_PRICE" });
  });

  it("STOCK_PRICE WITHOUT sink → degrades to html_card (still card-supported)", () => {
    const rp = resolveRenderPlan(
      plan("STOCK_PRICE"),
      { STOCK_PRICE: { success: true, ticker: "AAPL", currentPrice: { price: 200 } } },
      NO_SINK,
    );
    expect(rp).toEqual({ kind: "html_card", source: "STOCK_PRICE" });
  });

  it("migrated VALUATION + structured sink → source_card (off the HTML path)", () => {
    const rp = resolveRenderPlan(
      plan("VALUATION"),
      { VALUATION: { success: true, ticker: "NVDA", current_price: 207, ai_recommendation: { decision: "OVERVALUED" } } },
      SINK,
    );
    expect(rp).toEqual({ kind: "source_card", source: "VALUATION" });
  });

  it("VALUATION WITHOUT sink → degrades to html_card (still card-supported)", () => {
    const rp = resolveRenderPlan(
      plan("VALUATION"),
      { VALUATION: { success: true, ticker: "NVDA", current_price: 207, ai_recommendation: { decision: "OVERVALUED" } } },
      NO_SINK,
    );
    expect(rp).toEqual({ kind: "html_card", source: "VALUATION" });
  });

  it("migrated PERFORMANCE + structured sink → source_card (off the HTML path)", () => {
    const rp = resolveRenderPlan(
      plan("PERFORMANCE"),
      { PERFORMANCE: { primaryTicker: "AAPL", peers: ["MSFT"], metrics: { AAPL: {} } } },
      SINK,
    );
    expect(rp).toEqual({ kind: "source_card", source: "PERFORMANCE" });
  });

  it("PERFORMANCE WITHOUT sink → degrades to html_card (still card-supported)", () => {
    const rp = resolveRenderPlan(
      plan("PERFORMANCE"),
      { PERFORMANCE: { primaryTicker: "AAPL", peers: ["MSFT"], metrics: { AAPL: {} } } },
      NO_SINK,
    );
    expect(rp).toEqual({ kind: "html_card", source: "PERFORMANCE" });
  });

  it("migrated FDA + structured sink → source_card (off the HTML path)", () => {
    const rp = resolveRenderPlan(
      plan("FDA"),
      { FDA: { success: true, data: { ticker: "PFE", company: "Pfizer", drugs: [] } } },
      SINK,
    );
    expect(rp).toEqual({ kind: "source_card", source: "FDA" });
  });

  it("FDA WITHOUT sink → degrades to html_card (still card-supported)", () => {
    const rp = resolveRenderPlan(
      plan("FDA"),
      { FDA: { success: true, data: { ticker: "PFE", company: "Pfizer", drugs: [] } } },
      NO_SINK,
    );
    expect(rp).toEqual({ kind: "html_card", source: "FDA" });
  });

  it("migrated TRENDING + structured sink → source_card", () => {
    const rp = resolveRenderPlan(
      plan("TRENDING"),
      { TRENDING: { success: true, categories: [{ id: "top_gainers", stocks: [{ ticker: "NVDA" }] }] } },
      SINK,
    );
    expect(rp).toEqual({ kind: "source_card", source: "TRENDING" });
  });

  it("TRENDING bypass: a FAILED payload still routes to source_card (card renders the error state)", () => {
    const rp = resolveRenderPlan(plan("TRENDING"), { TRENDING: { success: false } }, SINK);
    expect(rp).toEqual({ kind: "source_card", source: "TRENDING" });
  });

  it("migrated MARKET_DATA + structured sink → source_card", () => {
    const rp = resolveRenderPlan(
      plan("MARKET_DATA"),
      { MARKET_DATA: { success: true, queryType: "price", quotes: [{ ticker: "AAPL" }] } },
      SINK,
    );
    expect(rp).toEqual({ kind: "source_card", source: "MARKET_DATA" });
  });

  it("MARKET_DATA failure (no bypass) → llm, not a card", () => {
    const rp = resolveRenderPlan(
      plan("MARKET_DATA"),
      { MARKET_DATA: { success: false, error: "MARKET_DATA_UNAVAILABLE" } },
      SINK,
    );
    expect(rp).toEqual({ kind: "llm" });
  });

  it("migrated RUMOR + structured sink → source_card", () => {
    const rp = resolveRenderPlan(
      plan("RUMOR", { isRumorOnly: true }),
      { RUMOR: { rumor: "X acquires Y", label: "Unverified", summary: "no confirmation" } },
      SINK,
    );
    expect(rp).toEqual({ kind: "source_card", source: "RUMOR" });
  });

  it("migrated EARNINGS calendar + structured sink → source_card", () => {
    const rp = resolveRenderPlan(
      plan("EARNINGS"),
      { EARNINGS: { topic: "calendar", calendar: { rows: [{ symbol: "AAPL" }] } } },
      SINK,
    );
    expect(rp).toEqual({ kind: "source_card", source: "EARNINGS" });
  });

});
