/** Multi-intent routing cases. Run: npx tsx scripts/routing/run.ts multiintent
 *
 * Composite queries that must route to 2+ data sources — the scenarios bugs
 * 003/004/005 are about (co-intents must survive; each source gets its own
 * scoped query). Covers a spread of data sources: VALUATION, NEWS, RATING,
 * PERFORMANCE, STOCK_PRICE, EARNINGS, COMPETITIVE, FDA, STOCK_PICKER.
 *
 * HELD-OUT, NOT prompt few-shots: every query here is deliberately a paraphrase
 * / different ticker from the worked examples in classifier/prompt.ts. Reusing a
 * prompt example would just test whether the model can copy its own in-context
 * answer key (it always can) — it would NOT test routing generalization. Before
 * adding a case, grep prompt.ts for the query and reword if it matches.
 *
 * `requiredIncludes` asserts the co-intents survive (a dropped secondary source
 * is invisible to the primary/topic/tickers tuple — see harness). `scopedQuery`
 * asserts per-source scoping (bug 004) — note its excludes pass VACUOUSLY if the
 * source is absent, so confirm a red against the raw api_params. Tier is `target`
 * because the exact source SET is LLM-dependent (jitter); the routing fix only
 * guarantees co-intents aren't deterministically dropped once emitted.
 */
import type { Suite } from "./harness";

export const multiIntentSuite: Suite = {
  name: "multiintent",
  cases: [
    // EARNINGS + VALUATION (bug 003/004 canonical, held-out: GOOGL/AMZN, not the
    // prompt's AAPL/MSFT) — earnings question must stay scoped to GOOGL, valuation
    // handles the GOOGL-vs-AMZN comparison. The scopedQuery is the bug-004 teeth:
    // the EARNINGS.question must not drag in the valuation clause or AMZN.
    { query: "谷歌的财报怎么样，再跟亚马逊比一下估值", tier: "target",
      expect: { primaryOneOf: ["EARNINGS", "VALUATION"], tickers: ["GOOGL", "AMZN"], requiredIncludes: ["EARNINGS", "VALUATION"],
        scopedQuery: { EARNINGS: { excludes: ["估值", "valuation", "亚马逊", "amazon", "amzn"] } } },
      note: "earnings + valuation comparison (held-out)" },

    // Investment decision → VALUATION + RATING (+ NEWS/PERFORMANCE/STOCK_PRICE).
    { query: "PLTR 现在这个点位还值得建仓吗?", tier: "target",
      expect: { primaryOneOf: ["VALUATION"], tickers: ["PLTR"], requiredIncludes: ["VALUATION", "RATING"] },
      note: "investment decision combo (held-out)" },

    // Price-move explanation → NEWS + STOCK_PRICE (+ EARNINGS). Held-out: AMD
    // drop, not the prompt's NVDA rally.
    { query: "AMD 今天为什么大跌?", tier: "target",
      expect: { primaryOneOf: ["NEWS"], tickers: ["AMD"], requiredIncludes: ["NEWS", "STOCK_PRICE"] },
      note: "news + price (+ earnings) catalyst (held-out)" },

    // Company overview → NEWS + PERFORMANCE (+ STOCK_PRICE).
    { query: "英特尔最近整体情况如何?", tier: "target",
      expect: { primaryOneOf: ["NEWS", "PERFORMANCE"], tickers: ["INTC"], requiredIncludes: ["NEWS", "PERFORMANCE"] },
      note: "company overview (held-out)" },

    // Risk analysis → NEWS + COMPETITIVE + PERFORMANCE + RATING.
    { query: "Rivian 面临哪些下行风险?", tier: "target",
      expect: { primaryOneOf: ["NEWS", "COMPETITIVE"], tickers: ["RIVN"], requiredIncludes: ["COMPETITIVE", "NEWS"] },
      note: "risk analysis (competitive + news, held-out)" },

    // Two-company investment comparison → VALUATION + RATING (+ COMPETITIVE/NEWS), multi-ticker.
    { query: "英伟达和 AMD 现在哪个更适合买入?", tier: "target",
      expect: { primaryOneOf: ["VALUATION", "RATING"], tickers: ["NVDA", "AMD"], requiredIncludes: ["VALUATION", "RATING"] },
      note: "two-company investment comparison (held-out)" },

    // STOCK_PICKER composite → STOCK_PICKER + NEWS (explicit second lens).
    { query: "rate PLTR with the stock picker and pull its recent headlines", tier: "target",
      expect: { primaryOneOf: ["STOCK_PICKER"], tickers: ["PLTR"], requiredIncludes: ["STOCK_PICKER", "NEWS"] },
      note: "stock-picker score + news (held-out)" },

    // News + FDA → NEWS primary, FDA secondary. Held-out: Moderna, not Pfizer.
    { query: "Moderna 的 FDA 审批最近有什么进展?", tier: "target",
      expect: { primaryOneOf: ["NEWS", "FDA"], tickers: ["MRNA"], requiredIncludes: ["NEWS", "FDA"] },
      note: "news + FDA (held-out)" },

    // ── Explicit dual-ask cases ──────────────────────────────────────────────
    // The cases above mostly read as ONE surface ask that fans out to multiple
    // sources. These are genuine two-distinct-ask queries (often two different
    // tickers, one per intent), which is where bug 004's per-source scoping bites
    // hardest: each source's scoped query must cover ONLY its own clause. The
    // scopedQuery excludes assert the other intent's clause/ticker did not leak.

    // EARNINGS(TSLA) + RATING(NVDA) — two tickers, one per intent. RATING has no
    // free-text query, so we can only police the EARNINGS side.
    { query: "特斯拉的财报怎么样，还有英伟达最新的分析师评级", tier: "target",
      expect: { primaryOneOf: ["EARNINGS", "RATING"], tickers: ["TSLA", "NVDA"], requiredIncludes: ["EARNINGS", "RATING"],
        scopedQuery: { EARNINGS: { excludes: ["评级", "rating", "英伟达", "nvidia", "nvda"] } } },
      note: "earnings(TSLA) + rating(NVDA)" },

    // VALUATION(AAPL) + FDA(PFE) — valuation query must not absorb the FDA clause.
    { query: "给我苹果的估值，再查一下辉瑞的 FDA 审批进展", tier: "target",
      expect: { primaryOneOf: ["VALUATION", "FDA"], tickers: ["AAPL", "PFE"], requiredIncludes: ["VALUATION", "FDA"],
        scopedQuery: { VALUATION: { excludes: ["fda", "审批", "辉瑞", "pfizer", "pfe"] } } },
      note: "valuation(AAPL) + FDA(PFE)" },

    // NEWS(NVDA) + EARNINGS(MSFT) — both sources carry free text; each must stay
    // on its own ticker/topic.
    { query: "英伟达最近有什么新闻？另外微软的财报怎么样", tier: "target",
      expect: { primaryOneOf: ["NEWS", "EARNINGS"], tickers: ["NVDA", "MSFT"], requiredIncludes: ["NEWS", "EARNINGS"],
        scopedQuery: {
          NEWS: { excludes: ["财报", "earnings", "微软", "microsoft", "msft"] },
          EARNINGS: { excludes: ["新闻", "news", "英伟达", "nvidia", "nvda"] },
        } },
      note: "news(NVDA) + earnings(MSFT)" },

    // VALUATION(TSLA, BYDDY comparison) + NEWS(TSLA) — shared ticker (TSLA) but
    // distinct asks; the NEWS query must not pull in the valuation/comparison
    // clause or the second ticker.
    { query: "比较特斯拉和比亚迪的估值，再帮我看看特斯拉最近的新闻", tier: "target",
      expect: { primaryOneOf: ["VALUATION", "NEWS"], tickers: ["TSLA", "BYDDY"], requiredIncludes: ["VALUATION", "NEWS"],
        scopedQuery: { NEWS: { excludes: ["估值", "valuation", "比亚迪", "byd", "byddy"] } } },
      note: "valuation(TSLA vs BYDDY) + news(TSLA)" },

    // EARNINGS(AAPL) + STOCK_PRICE(TSLA), English — two tickers, one per intent.
    { query: "What's Apple's latest earnings, and how is Tesla's stock price doing?", tier: "target",
      expect: { primaryOneOf: ["EARNINGS", "STOCK_PRICE"], tickers: ["AAPL", "TSLA"], requiredIncludes: ["EARNINGS", "STOCK_PRICE"],
        scopedQuery: { EARNINGS: { excludes: ["stock price", "tesla", "tsla"] } } },
      note: "earnings(AAPL) + stock_price(TSLA)" },
  ],
};
