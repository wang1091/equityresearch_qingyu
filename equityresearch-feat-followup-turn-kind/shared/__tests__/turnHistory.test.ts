import { describe, it, expect } from "vitest";
import {
  STRUCTURED_MESSAGE_PREFIX,
  parseEnvelope,
  serializeEnvelope,
  specFor,
  projectToClassifierHistory,
  type TurnEnvelope,
} from "../turnHistory";

describe("turnHistory — text degrades to a bare string (byte-compat with legacy rows)", () => {
  it("serializes text without the prefix", () => {
    const out = serializeEnvelope({ version: 1, type: "text", content: "AAPL is up 2%." });
    expect(out).toBe("AAPL is up 2%.");
    expect(out.startsWith(STRUCTURED_MESSAGE_PREFIX)).toBe(false);
  });

  it("parses a bare string (legacy plain answer) as a text envelope", () => {
    const env = parseEnvelope("just some markdown");
    expect(env).toMatchObject({ version: 1, type: "text", content: "just some markdown" });
    expect(projectToClassifierHistory("just some markdown")).toBe("just some markdown");
  });
});

describe("turnHistory — news projections match the legacy toAgentHistoryContent", () => {
  it("news_v2 → title/dek/summary; restore rebuilds newsData", () => {
    const env: TurnEnvelope = {
      version: 1,
      type: "news_v2",
      content: "<card/>",
      newsData: { content: { title: "T", dek: "D", summary: "S" } },
    };
    const wire = serializeEnvelope(env);
    expect(wire.startsWith(STRUCTURED_MESSAGE_PREFIX)).toBe(true);
    expect(projectToClassifierHistory(wire)).toBe("T\nD\nS");
    expect(specFor("news_v2").restore?.(parseEnvelope(wire))).toMatchObject({
      content: "<card/>",
      newsData: { content: { title: "T" } },
    });
  });

  it("news_brief → SmartNews brief bottomLine + signals/insights/analyses", () => {
    const env: TurnEnvelope = {
      version: 1,
      type: "news_brief",
      content: "x",
      briefData: {
        bottomLine: { realityCheck: "RC", valuationChange: "VC", watchNext: "WN" },
        keySignals: ["sig1", ""],
        insights: [{ text: "ins1" }, { text: "" }],
        analyses: [{ text: "an1" }],
      },
    };
    expect(projectToClassifierHistory(serializeEnvelope(env))).toBe(
      "SmartNews brief:\nRC\nVC\nWN\nsig1\nins1\nan1",
    );
  });
});

describe("turnHistory — unified persists unifiedData (display) and routes on content", () => {
  it("round-trips unifiedData and projects the markdown body", () => {
    const env: TurnEnvelope = {
      version: 1,
      type: "unified",
      content: "NVDA looks expensive [S1].",
      unifiedData: { verdict: { stance: "SELL" }, citations: [{ id: "S1" }] },
    };
    const wire = serializeEnvelope(env);
    const parsed = parseEnvelope(wire);
    expect(parsed.type).toBe("unified");
    // routing history = the markdown body (unchanged from before unifiedData was persisted)
    expect(projectToClassifierHistory(wire)).toBe("NVDA looks expensive [S1].");
    // display restore brings unifiedData (citations/verdict) back after reload
    expect(specFor("unified").restore?.(parsed)).toMatchObject({
      content: "NVDA looks expensive [S1].",
      unifiedData: { verdict: { stance: "SELL" }, citations: [{ id: "S1" }] },
    });
  });
});

describe("turnHistory — html_card routes on classifierText, displays content (live === reload)", () => {
  const env: TurnEnvelope = {
    version: 1,
    type: "html_card",
    content: "<div><table><tr><td>BFLY</td><td>+55.87%</td></tr></table></div>",
    classifierText: "[TRENDING top_gainers] BFLY/Butterfly +55.87%; WOLF/Wolfspeed +17.91%",
  };

  it("serializes as an envelope (not bare) and projects the precomputed line, not the card HTML", () => {
    const wire = serializeEnvelope(env);
    expect(wire.startsWith(STRUCTURED_MESSAGE_PREFIX)).toBe(true);
    const projected = projectToClassifierHistory(wire);
    expect(projected).toBe(env.classifierText);
    expect(projected).not.toContain("<table"); // never the un-routable markup
  });

  it("restores the card HTML for display", () => {
    expect(specFor("html_card").restore?.(parseEnvelope(serializeEnvelope(env)))).toMatchObject({
      content: env.content,
    });
  });

  it("classifierText overrides even a known type's own projection", () => {
    // a news envelope that also carries a precomputed line → the line wins
    const wire = serializeEnvelope({
      version: 1,
      type: "news_v2",
      content: "x",
      newsData: { content: { title: "T", dek: "D", summary: "S" } },
      classifierText: "OVERRIDE LINE",
    });
    expect(projectToClassifierHistory(wire)).toBe("OVERRIDE LINE");
  });
});

describe("turnHistory — graceful degradation (never throws)", () => {
  it("malformed JSON after the prefix degrades to text with the original content", () => {
    const broken = `${STRUCTURED_MESSAGE_PREFIX}{not valid json`;
    expect(parseEnvelope(broken)).toEqual({ version: 1, type: "text", content: broken });
  });

  it("unknown structured type falls back to its content for routing", () => {
    const env = { version: 1, type: "future_source", content: "fallback body" };
    const wire = `${STRUCTURED_MESSAGE_PREFIX}${JSON.stringify(env)}`;
    expect(parseEnvelope(wire).type).toBe("future_source"); // preserved, not lost
    expect(projectToClassifierHistory(wire)).toBe("fallback body"); // routes on content
    expect(specFor("future_source").type).toBe("text"); // unknown → text spec
  });
});

describe("turnHistory — competitive round-trips through reload (folded onto source_card)", () => {
  it("competitive (legacy envelope) → routes on company/industry/assessment; restore rebuilds cardData", () => {
    // Backward-compat: conversations persisted BEFORE the source_card fold still
    // carry `type:"competitive"` with `competitiveData`. The spec re-projects via
    // the shared projector and restores into cardData so the registry renders it.
    const env: TurnEnvelope = {
      version: 1,
      type: "competitive",
      content: "",
      competitiveData: {
        success: true,
        company: "Joby Aviation",
        ticker: "JOBY",
        industry: "eVTOL",
        overall_assessment: "Early-mover with regulatory moat.",
        forces: {},
      },
    };
    const wire = serializeEnvelope(env);
    expect(wire.startsWith(STRUCTURED_MESSAGE_PREFIX)).toBe(true);
    // CLASSIFIER view: a meaningful routing line even though content is "".
    expect(projectToClassifierHistory(wire)).toBe(
      "Competitive analysis: Joby Aviation (JOBY)\neVTOL\nEarly-mover with regulatory moat.",
    );
    // DISPLAY view: rebuilt into cardData so <CompetitiveResultCard> re-renders on reload.
    expect(specFor("competitive").restore?.(parseEnvelope(wire))).toMatchObject({
      content: "",
      cardData: { source: "COMPETITIVE", payload: { company: "Joby Aviation", ticker: "JOBY" } },
    });
  });
});

describe("turnHistory — generic source_card (migration target)", () => {
  it("source_card → routes via projectSourceCard; restore rebuilds cardData", () => {
    const env: TurnEnvelope = {
      version: 1,
      type: "source_card",
      content: "",
      cardData: {
        source: "RATING",
        payload: { ticker: "AAPL", rating: "HOLD", price: 298.01, valuation: { status: "Overvalued" } },
      },
    };
    const wire = serializeEnvelope(env);
    expect(wire.startsWith(STRUCTURED_MESSAGE_PREFIX)).toBe(true);
    expect(projectToClassifierHistory(wire)).toBe(
      "RATING AAPL consensus HOLD @ $298.01 valuation Overvalued",
    );
    expect(specFor("source_card").restore?.(parseEnvelope(wire))).toMatchObject({
      content: "",
      cardData: { source: "RATING", payload: { ticker: "AAPL" } },
    });
  });

  it("source_card STOCK_PRICE → projects ticker/price/change; restore rebuilds cardData", () => {
    const env: TurnEnvelope = {
      version: 1,
      type: "source_card",
      content: "",
      cardData: {
        source: "STOCK_PRICE",
        payload: { ticker: "AAPL", currentPrice: { price: 201.5, changePercent: -1.23 } },
      },
    };
    const wire = serializeEnvelope(env);
    expect(projectToClassifierHistory(wire)).toBe("STOCK_PRICE AAPL @ $201.50 (-1.23%)");
    expect(specFor("source_card").restore?.(parseEnvelope(wire))).toMatchObject({
      content: "",
      cardData: { source: "STOCK_PRICE", payload: { ticker: "AAPL" } },
    });
  });

  it("source_card VALUATION → projects decision/fair-value; restore rebuilds cardData", () => {
    const env: TurnEnvelope = {
      version: 1,
      type: "source_card",
      content: "",
      cardData: {
        source: "VALUATION",
        payload: {
          ticker: "NVDA",
          current_price: 207.41,
          ai_recommendation: { decision: "OVERVALUED", chosen_price: 60.7, upside_percentage: "-70.7" },
        },
      },
    };
    const wire = serializeEnvelope(env);
    expect(projectToClassifierHistory(wire)).toBe("VALUATION NVDA overvalued fair $60.70 vs $207.41 (-70.7%)");
    expect(specFor("source_card").restore?.(parseEnvelope(wire))).toMatchObject({
      content: "",
      cardData: { source: "VALUATION", payload: { ticker: "NVDA" } },
    });
  });

  it("source_card PERFORMANCE → projects ticker/peers/rating; restore rebuilds cardData", () => {
    const env: TurnEnvelope = {
      version: 1,
      type: "source_card",
      content: "",
      cardData: {
        source: "PERFORMANCE",
        payload: {
          primaryTicker: "AAPL",
          peers: ["MSFT", "GOOGL"],
          metrics: { AAPL: {} },
          analysis: { ticker: "AAPL", analysis: JSON.stringify({ rating: "Fairly Valued", summary: ["x"] }) },
        },
      },
    };
    const wire = serializeEnvelope(env);
    expect(projectToClassifierHistory(wire)).toBe("PERFORMANCE AAPL vs MSFT, GOOGL rated Fairly Valued");
    expect(specFor("source_card").restore?.(parseEnvelope(wire))).toMatchObject({
      content: "",
      cardData: { source: "PERFORMANCE", payload: { primaryTicker: "AAPL" } },
    });
  });

  it("source_card FDA → projects company/ticker/event count; restore rebuilds cardData", () => {
    const env: TurnEnvelope = {
      version: 1,
      type: "source_card",
      content: "",
      cardData: {
        source: "FDA",
        payload: {
          success: true,
          data: {
            ticker: "PFE",
            company: "Pfizer",
            drugs: [{ drug: "Examplemab", status: "PENDING" }, { drug: "Demodrug", status: "APPROVED" }],
          },
        },
      },
    };
    const wire = serializeEnvelope(env);
    expect(projectToClassifierHistory(wire)).toBe("FDA PFE Pfizer 2 pipeline events");
    expect(specFor("source_card").restore?.(parseEnvelope(wire))).toMatchObject({
      content: "",
      cardData: { source: "FDA", payload: { data: { ticker: "PFE" } } },
    });
  });

  it("source_card TRENDING → projects the list line (same as the html_card path); restore rebuilds cardData", () => {
    const env: TurnEnvelope = {
      version: 1,
      type: "source_card",
      content: "",
      cardData: {
        source: "TRENDING",
        payload: {
          success: true,
          date: "2026-06-20",
          categories: [
            { id: "top_gainers", stocks: [{ ticker: "NVDA", companyName: "Nvidia", changePercent: 5.2 }, { ticker: "AMD", companyName: "AMD", changePercent: 3.1 }] },
          ],
        },
      },
    };
    const wire = serializeEnvelope(env);
    expect(projectToClassifierHistory(wire)).toBe("[TRENDING top_gainers @2026-06-20] NVDA/Nvidia +5.20%; AMD/AMD +3.10%");
    expect(specFor("source_card").restore?.(parseEnvelope(wire))).toMatchObject({
      content: "",
      cardData: { source: "TRENDING", payload: { date: "2026-06-20" } },
    });
  });

  it("source_card MARKET_DATA → projects the list line; restore rebuilds cardData", () => {
    const env: TurnEnvelope = {
      version: 1,
      type: "source_card",
      content: "",
      cardData: {
        source: "MARKET_DATA",
        payload: {
          success: true,
          queryType: "price",
          fetchedAt: "2026-06-20T12:00:00.000Z",
          quotes: [{ ticker: "AAPL", companyName: "Apple Inc.", sector: "Technology" }],
        },
      },
    };
    const wire = serializeEnvelope(env);
    expect(projectToClassifierHistory(wire)).toBe("[MARKET_DATA price @2026-06-20] AAPL/Apple Inc./Technology");
    expect(specFor("source_card").restore?.(parseEnvelope(wire))).toMatchObject({
      content: "",
      cardData: { source: "MARKET_DATA", payload: { queryType: "price" } },
    });
  });

  it("source_card RUMOR → projects rumor/verdict/confidence; restore rebuilds cardData", () => {
    const env: TurnEnvelope = {
      version: 1,
      type: "source_card",
      content: "",
      cardData: {
        source: "RUMOR",
        payload: { rumor: "Qualcomm is going to acquire Intel", label: "Unverified", confidence: "Low", summary: "no confirmation", sources: [] },
      },
    };
    const wire = serializeEnvelope(env);
    expect(projectToClassifierHistory(wire)).toBe('RUMOR "Qualcomm is going to acquire Intel" verdict Unverified confidence Low');
    expect(specFor("source_card").restore?.(parseEnvelope(wire))).toMatchObject({
      content: "",
      cardData: { source: "RUMOR", payload: { label: "Unverified" } },
    });
  });

  it("source_card STOCK_PICKER → projects the score-off line; restore rebuilds cardData", () => {
    const env: TurnEnvelope = {
      version: 1,
      type: "source_card",
      content: "",
      cardData: {
        source: "STOCK_PICKER",
        payload: {
          mode: "comparison",
          labels: ["AAPL", "MSFT"],
          results: [
            { ticker: "AAPL", recommendation: "BUY", finalScore: 82 },
            { ticker: "MSFT", recommendation: "HOLD", finalScore: 70 },
          ],
        },
      },
    };
    const wire = serializeEnvelope(env);
    expect(projectToClassifierHistory(wire)).toBe("[STOCK_PICKER comparison] AAPL BUY 82; MSFT HOLD 70");
    expect(specFor("source_card").restore?.(parseEnvelope(wire))).toMatchObject({
      content: "",
      cardData: { source: "STOCK_PICKER", payload: { mode: "comparison" } },
    });
  });

  it("source_card EARNINGS (ask) → projects ticker/period/answer snippet; restore rebuilds cardData", () => {
    const env: TurnEnvelope = {
      version: 1,
      type: "source_card",
      content: "",
      cardData: {
        source: "EARNINGS",
        payload: { topic: "ask", ticker: "AAPL", year: 2025, quarter: 2, hasAnswer: true, answer: "Revenue grew 5% YoY" },
      },
    };
    const wire = serializeEnvelope(env);
    expect(projectToClassifierHistory(wire)).toBe("EARNINGS AAPL 2025 Q2 Q&A: Revenue grew 5% YoY");
    expect(specFor("source_card").restore?.(parseEnvelope(wire))).toMatchObject({
      content: "",
      cardData: { source: "EARNINGS", payload: { ticker: "AAPL" } },
    });
  });
});
