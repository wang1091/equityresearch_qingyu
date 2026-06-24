import { describe, it, expect } from "vitest";
import { fanOutByRole, type RoledEntity } from "../apiParamsFanout";

const SET = ["BFLY", "WOLF", "QS", "BE", "OUST"];

/** All-TARGET entities (set-screen framing: every ticker analyzed independently). */
const T = (symbols: string[]): RoledEntity[] =>
  symbols.map((symbol) => ({ symbol, role: "TARGET" }));

/** Comparison framing: first ticker TARGET (subject), the rest PEER. */
const cmp = (symbols: string[]): RoledEntity[] =>
  symbols.map((symbol, i) => ({ symbol, role: i === 0 ? "TARGET" : "PEER" }));

describe("fanOutByRole", () => {
  it("VALUATION: rebuilds per-ticker array from entities, preserves base (query)", () => {
    const out = fanOutByRole(
      { VALUATION: { tickers: ["X"], query: "估值最贵" } }, // LLM shape ignored; rebuilt from entities
      T(SET),
      ["VALUATION"],
    )!;
    expect(out.VALUATION).toEqual(SET.map((ticker) => ({ query: "估值最贵", ticker })));
  });

  it("RATING / STOCK_PRICE also fan out (no api_params entry → bare {ticker} per ticker)", () => {
    const out = fanOutByRole({}, T(["AAPL", "MSFT"]), ["RATING", "STOCK_PRICE"])!;
    expect(out.RATING).toEqual([{ ticker: "AAPL" }, { ticker: "MSFT" }]);
    expect(out.STOCK_PRICE).toEqual([{ ticker: "AAPL" }, { ticker: "MSFT" }]);
  });

  it("comparison framing (1 TARGET) → PERFORMANCE single-call, untouched", () => {
    const input = { PERFORMANCE: { tickers: SET } };
    const out = fanOutByRole(input, cmp(SET), ["PERFORMANCE"])!;
    expect(out.PERFORMANCE).toEqual({ tickers: SET }); // peer semantic preserved
  });

  it("PERFORMANCE fans out when every ticker is TARGET (set-screen), capped at 5", () => {
    const six = ["A", "B", "C", "D", "E", "F"];
    const out = fanOutByRole({ PERFORMANCE: { tickers: six } }, T(six), ["PERFORMANCE"])!;
    expect(out.PERFORMANCE).toEqual(["A", "B", "C", "D", "E"].map((ticker) => ({ ticker }))); // cap 5
  });

  it("VALUATION/RATING fan all entities, cap 8 (independent of PERFORMANCE)", () => {
    const ten = "ABCDEFGHIJ".split("");
    const out = fanOutByRole({}, T(ten), ["RATING"])!;
    expect(out.RATING).toHaveLength(8);
  });

  it("MARKET_DATA / STOCK_PICKER / EARNINGS untouched (native multi / collapse)", () => {
    const input = {
      MARKET_DATA: { tickers: SET, queryType: "market_cap" },
      STOCK_PICKER: { tickers: SET, query: "compare" },
      EARNINGS: { topic: "transcript_qa", question: "q" },
    };
    const out = fanOutByRole(input, T(SET), ["MARKET_DATA", "STOCK_PICKER", "EARNINGS"])!;
    expect(out).toEqual(input);
  });

  it("no-op for <2 entities (single / empty / undefined)", () => {
    const single = { VALUATION: { ticker: "AAPL" } };
    expect(fanOutByRole(single, T(["AAPL"]), ["VALUATION"])).toEqual(single); // 1 entity → no fan
    expect(fanOutByRole(single, [], ["VALUATION"])).toBe(single); // empty → identity
    expect(fanOutByRole(single, undefined, ["VALUATION"])).toBe(single);
  });

  it("dedupes/uppercases and caps fan-out at 8", () => {
    const many = ["a", "A", "b", "c", "d", "e", "f", "g", "h", "i", "j"]; // 'a'/'A' dup → 10 unique
    const out = fanOutByRole({}, T(many), ["RATING"])!;
    expect(out.RATING).toHaveLength(8); // capped
    expect(out.RATING[0]).toEqual({ ticker: "A" }); // uppercased + deduped
  });

  it("only rewrites sources present in required_data", () => {
    const out = fanOutByRole(
      { VALUATION: { query: "v" }, RATING: { ticker: "Z" } },
      T(SET),
      ["VALUATION"],
    )!;
    expect(Array.isArray(out.VALUATION)).toBe(true);
    expect(out.RATING).toEqual({ ticker: "Z" }); // not in required_data → untouched
  });

  it("all-TARGET does NOT fan out EARNINGS/MARKET_DATA (still excluded)", () => {
    const input = {
      EARNINGS: { topic: "transcript_qa", question: "q" },
      MARKET_DATA: { tickers: SET, queryType: "market_cap" },
    };
    const out = fanOutByRole(input, T(SET), ["EARNINGS", "MARKET_DATA", "PERFORMANCE"])!;
    expect(out.EARNINGS).toEqual(input.EARNINGS);
    expect(out.MARKET_DATA).toEqual(input.MARKET_DATA);
  });

  it("mixed required_data: fans VALUATION + PERFORMANCE(all TARGET), leaves NEWS untouched", () => {
    const out = fanOutByRole(
      { VALUATION: { query: "v" }, PERFORMANCE: { tickers: SET }, NEWS: { query: "n" } },
      T(SET),
      ["VALUATION", "PERFORMANCE", "NEWS"],
    )!;
    expect(out.VALUATION).toEqual(SET.map((ticker) => ({ query: "v", ticker })));
    expect(out.PERFORMANCE).toEqual(SET.map((ticker) => ({ ticker })));
    expect(out.NEWS).toEqual({ query: "n" }); // query-based, never fanned
  });
});
