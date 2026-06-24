import { describe, it, expect, afterEach, vi } from "vitest";
import { resolveListOperand, detectTranslateCommand, detectCorrection, detectChitchat, answerChitchat, detectRecall, answerRecall } from "../turnKind";
import { buildSnapshot } from "../index";
import type { LastAnswerSnapshot } from "../conversation";
import type { ListSnapshot } from "@shared/listSnapshot";

const SET = { tickers: ["BFLY", "WOLF", "QS"] };

/** A prior-turn activeList — the operable set a set-screen targets (4b-0: structured,
 *  not a history-text scan). */
function list(tickers: string[], source = "TRENDING"): ListSnapshot {
  return {
    source,
    capturedAt: "2026-06-21T00:00:00.000Z",
    views: [
      {
        id: "top_gainers",
        label: "Top Gainers",
        ranking: { kind: "metric", field: "changePercent", direction: "desc" },
        items: tickers.map((ticker) => ({ ticker, name: ticker, metrics: { changePercent: 1 } })),
      },
    ],
  };
}
const activeList = list(SET.tickers);
const isScreen = (msg: string, c: { tickers?: string[] }, l: ListSnapshot | undefined) =>
  resolveListOperand(msg, c, l).kind === "screen";

describe("resolveListOperand — set-screen over the activeList", () => {
  it("screen: set-anaphor + ≥2 tickers + a routable activeList", () => {
    expect(isScreen("这些里哪只业绩最强?", SET, activeList)).toBe(true);
    expect(isScreen("其中哪只业绩驱动?", SET, activeList)).toBe(true);
    expect(isScreen("which of these is earnings-driven?", SET, activeList)).toBe(true);
  });

  it("returns the operand tickers; carries NO speculative view (4b-1 selects view by predicate)", () => {
    const op = resolveListOperand("这些里哪只业绩最强?", SET, activeList);
    expect(op.kind).toBe("screen");
    if (op.kind === "screen") {
      expect(op.tickers).toEqual(SET.tickers);
      expect("view" in op).toBe(false);
    }
  });

  it("none: comparison (no set-anaphor) → keeps PERFORMANCE peer single-call", () => {
    expect(isScreen("对比 AMD 和 NVDA 营收", { tickers: ["AMD", "NVDA"] }, activeList)).toBe(false);
  });

  it("none: set-anaphor but only one ticker", () => {
    expect(isScreen("这些里哪只业绩最强?", { tickers: ["BFLY"] }, activeList)).toBe(false);
  });

  it("none: set-anaphor + tickers but NO activeList (the chat() degrade-to-FRESH path)", () => {
    expect(isScreen("这些里哪只业绩最强?", SET, undefined)).toBe(false);
  });

  it("none: activeList has no ≥2-routable view (single-ticker card)", () => {
    expect(isScreen("这些里哪只业绩最强?", SET, list(["BFLY"]))).toBe(false);
  });

  it("screen: 哪几只 / among them, over a STOCK_PICKER activeList", () => {
    expect(isScreen("哪几只财务最稳?", { tickers: ["QS", "BE"] }, list(["QS", "BE"], "STOCK_PICKER"))).toBe(true);
    expect(isScreen("which of them is cheapest?", { tickers: ["AAPL", "MSFT"] }, list(["AAPL", "MSFT"]))).toBe(true);
  });

  it("none: DRILL_IN singular ref (第一个 / the first one) is NOT a set-screen", () => {
    expect(isScreen("第一个详细说说", SET, activeList)).toBe(false);
    expect(isScreen("tell me more about the first one", SET, activeList)).toBe(false);
  });

  it("reports decision reason (provenance for the turn-decision trace)", () => {
    expect(resolveListOperand("英伟达估值如何", SET, activeList)).toMatchObject({ kind: "none", reason: "no_anaphor" });
    expect(resolveListOperand("其中哪只", { tickers: ["BFLY"] }, activeList)).toMatchObject({ kind: "none", reason: "tickers_lt_2" });
    expect(resolveListOperand("其中哪只", SET, undefined)).toMatchObject({ kind: "none", reason: "no_prior_list" });
    expect(resolveListOperand("其中哪只", SET, activeList)).toMatchObject({ kind: "screen", reason: "live" });
    // reload: no activeList, but the persisted projection line stands in
    const history = [{ role: "assistant", content: "[TRENDING top_gainers] BFLY +5%; WOLF +4%" }];
    expect(resolveListOperand("其中哪只", SET, undefined, history)).toMatchObject({ kind: "screen", reason: "reload_fallback" });
  });
});

describe("resolveListOperand — #5 materialize the screened set from view.items", () => {
  // A two-board snapshot (gainers + losers) so the bind is genuinely a choice, not the
  // trivial sole-view case.
  function twoBoards(): ListSnapshot {
    return {
      source: "TRENDING",
      capturedAt: "2026-06-21T00:00:00.000Z",
      views: [
        {
          id: "top_gainers",
          label: "Top Gainers",
          ranking: { kind: "metric", field: "changePercent", direction: "desc" },
          items: ["AAA", "BBB"].map((t) => ({ ticker: t, name: t, metrics: { changePercent: 1 } })),
        },
        {
          id: "top_losers",
          label: "Top Losers",
          ranking: { kind: "metric", field: "changePercent", direction: "asc" },
          items: ["CCC", "DDD"].map((t) => ({ ticker: t, name: t, metrics: { changePercent: -1 } })),
        },
      ],
    };
  }

  it("sole routable view: materializes the FULL list even when the classifier under-emits", () => {
    // activeList holds [BFLY,WOLF,QS]; the classifier echoed only 2 → we still screen all 3.
    const op = resolveListOperand("这些里哪只估值低?", { tickers: ["BFLY", "WOLF"] }, list(SET.tickers));
    expect(op).toMatchObject({ kind: "screen", reason: "live", sourced: "view" });
    if (op.kind === "screen") expect(op.tickers).toEqual(["BFLY", "WOLF", "QS"]);
  });

  it("ambiguous coexisting views, unnamed → keep the classifier set (no wrong default)", () => {
    const op = resolveListOperand("这些里哪只估值低?", { tickers: ["AAA", "CCC"] }, twoBoards());
    expect(op).toMatchObject({ kind: "screen", reason: "live", sourced: "classifier" });
    if (op.kind === "screen") expect(op.tickers).toEqual(["AAA", "CCC"]);
  });

  it("named view → materializes THAT view's items (not the classifier's board)", () => {
    // Classifier echoed the gainers [AAA,BBB]; the user named 跌幅榜 → screen the losers.
    const op = resolveListOperand("这些跌幅榜里哪只估值低?", { tickers: ["AAA", "BBB"] }, twoBoards());
    expect(op).toMatchObject({ kind: "screen", reason: "live", sourced: "view" });
    if (op.kind === "screen") expect(op.tickers).toEqual(["CCC", "DDD"]);
  });

  it("reload fallback has no structured items → classifier-sourced", () => {
    const history = [{ role: "assistant", content: "[TRENDING top_gainers] BFLY +5%; WOLF +4%" }];
    expect(resolveListOperand("其中哪只", SET, undefined, history)).toMatchObject({
      kind: "screen",
      reason: "reload_fallback",
      sourced: "classifier",
    });
  });
});

describe("detectTranslateCommand", () => {
  const prior = [{ role: "assistant", content: "Nvidia rose on strong demand." }];

  it("inline: 翻译成中文：<text> → inline_text payload", () => {
    const op = detectTranslateCommand("翻译成中文：The Fed held rates steady.", []);
    expect(op?.operationType).toBe("TRANSFORM");
    expect(op?.targetLanguage).toBe("zh");
    expect(op?.payloadSource).toBe("inline_text");
    expect(op?.payloadText).toBe("The Fed held rates steady.");
  });

  it("contextual bare command + prior turn → previous_assistant_message", () => {
    const op = detectTranslateCommand("翻译成中文", prior);
    expect(op?.payloadSource).toBe("previous_assistant_message");
    expect(op?.payloadText).toBe("Nvidia rose on strong demand.");
  });

  it("contextual English anaphor: translate that into English", () => {
    const op = detectTranslateCommand("translate that into English", [
      { role: "assistant", content: "英伟达因数据中心需求强劲而上涨。" },
    ]);
    expect(op?.targetLanguage).toBe("en");
    expect(op?.payloadSource).toBe("previous_assistant_message");
  });

  it("NEG outputLanguage (用中文解释 …) is NOT a translate command", () => {
    expect(detectTranslateCommand("用中文解释 Nvidia 为什么上涨", prior)).toBeNull();
    expect(detectTranslateCommand("answer in Chinese: why did Nvidia jump?", prior)).toBeNull();
  });

  it("NEG bare command with empty history → no payload → null", () => {
    expect(detectTranslateCommand("翻译成中文", [])).toBeNull();
  });

  it("NEG command naming a fetchable object → defer (no resolvable payload)", () => {
    expect(detectTranslateCommand("Translate Tesla earnings call into Chinese.", [])).toBeNull();
    expect(detectTranslateCommand("把特斯拉的财报翻译成中文", [])).toBeNull();
  });

  it("quoted span IS the object → inline_text literal payload", () => {
    const op = detectTranslateCommand('Translate "Tesla earnings call" into Chinese.', []);
    expect(op?.operationType).toBe("TRANSFORM");
    expect(op?.payloadSource).toBe("inline_text");
    expect(op?.payloadText).toBe("Tesla earnings call");
    expect(detectTranslateCommand("把「美联储维持利率」翻译成英文", [])?.payloadText).toBe("美联储维持利率");
  });

  it("NEG quotes only NAME a fetchable object (extra content around) → defer", () => {
    expect(
      detectTranslateCommand('translate the "Tesla earnings call" transcript into Chinese', []),
    ).toBeNull();
  });

  it("NEG no explicit target language → defer", () => {
    expect(detectTranslateCommand("翻译上面的", prior)).toBeNull();
  });
});

describe("detectCorrection", () => {
  it("POS: correction structures (zh + en)", () => {
    expect(detectCorrection("我说的是阿里不是百度")).toBe(true);
    expect(detectCorrection("不是百度，是阿里")).toBe(true);
    expect(detectCorrection("是阿里不是百度")).toBe(true);
    expect(detectCorrection("不,我问的是Q2")).toBe(true);
    expect(detectCorrection("no, I meant Alibaba")).toBe(true);
    expect(detectCorrection("I said BABA not BIDU")).toBe(true);
  });

  it("NEG: fresh queries / set-anaphor / bare entity must NOT be corrections", () => {
    expect(detectCorrection("苹果呢?")).toBe(false);
    expect(detectCorrection("对比 AMD 和 NVDA")).toBe(false);
    expect(detectCorrection("今日涨幅最大的股票")).toBe(false);
    expect(detectCorrection("BABA")).toBe(false);
    expect(detectCorrection("英伟达的估值如何")).toBe(false);
  });
});

describe("detectChitchat / answerChitchat", () => {
  it("POS pleasantry (whole-message)", () => {
    expect(detectChitchat("谢谢")).toBe("pleasantry");
    expect(detectChitchat("好的")).toBe("pleasantry");
    expect(detectChitchat("thanks")).toBe("pleasantry");
    expect(detectChitchat("ok")).toBe("pleasantry");
  });

  it("POS capability question", () => {
    expect(detectChitchat("你能做什么")).toBe("capability");
    expect(detectChitchat("能导出吗")).toBe("capability");
    expect(detectChitchat("what can you do")).toBe("capability");
  });

  it("NEG: finance queries never match", () => {
    expect(detectChitchat("苹果财报怎么样")).toBeNull();
    expect(detectChitchat("谢谢，帮我分析一下苹果")).toBeNull(); // not whole-message pleasantry
    expect(detectChitchat("你能分析苹果吗")).toBeNull(); // finance, not capability
  });

  it("answerChitchat returns localized canned text", () => {
    expect(answerChitchat("pleasantry", "zh")).toContain("不客气");
    expect(answerChitchat("capability", "en").toLowerCase()).toContain("valuation");
  });
});

describe("detectRecall — origin/freshness subset (Phase 4a)", () => {
  it("POS: explicit provenance / freshness phrasing (zh + en)", () => {
    expect(detectRecall("数据哪来的")).toBe(true);
    expect(detectRecall("数据哪来的呀")).toBe(true); // sentence-final particle
    expect(detectRecall("数据来源是什么")).toBe(true);
    expect(detectRecall("这些数据来源是什么")).toBe(true); // data anchor + 来源
    expect(detectRecall("什么时候的")).toBe(true);
    expect(detectRecall("上面的数据什么时候的?")).toBe(true);
    expect(detectRecall("Where does this data come from?")).toBe(true);
    expect(detectRecall("Where did these numbers come from?")).toBe(true);
    expect(detectRecall("What's the source of this data?")).toBe(true);
    expect(detectRecall("How recent is this data?")).toBe(true);
  });

  it("NEG: ambiguous 来源/出处 WITHOUT a data anchor → defer (finance words)", () => {
    expect(detectRecall("来源是什么")).toBe(false); // bare
    expect(detectRecall("出处是哪")).toBe(false);
    expect(detectRecall("收入来源是什么")).toBe(false);
    expect(detectRecall("资金来源")).toBe(false);
    expect(detectRecall("供应链来源有哪些")).toBe(false);
    expect(detectRecall("what is your source of revenue")).toBe(false);
    // anchor word present but the sentence keeps going (whole-message anchored)
    expect(detectRecall("这些数据来源会怎样影响英伟达估值")).toBe(false);
  });

  it("NEG: quality / computed-recall / fresh finance queries (Phase 4b or FRESH)", () => {
    expect(detectRecall("为什么这么说")).toBe(false);
    expect(detectRecall("准吗")).toBe(false);
    expect(detectRecall("可靠吗")).toBe(false);
    expect(detectRecall("哪个最高")).toBe(false);
    expect(detectRecall("英伟达估值如何")).toBe(false);
    expect(detectRecall("NVDA")).toBe(false);
  });
});

describe("answerRecall — reads frozen snapshot.sources, three distinct times", () => {
  const snapshot: LastAnswerSnapshot = {
    capturedAt: "2026-06-22T08:00:00.000Z",
    validData: {},
    sources: [
      { type: "link", provider: "NEWS", url: "https://reuters.com/x", title: "NVDA soars", publisher: "Reuters", date: "2026-06-20" },
      { type: "model", id: "src1", provider: "VALUATION", ticker: "NVDA", engine: "Valuation model", method: "DCF", asOf: "2026-06-22T07:59:00.000Z" },
      { type: "data", id: "src2", provider: "PERFORMANCE", ticker: "NVDA", asOf: "2026-06-22T07:59:00.000Z" },
    ],
  };

  it("zh: NEWS shows publish date, model/data show data-time asOf, footer shows capturedAt", () => {
    const a = answerRecall(snapshot, "zh");
    expect(a).toContain("https://reuters.com/x");
    expect(a).toContain("发布日期 2026-06-20"); // NEWS article publish date
    expect(a).toContain("Valuation model（DCF）");
    expect(a).toContain("数据时点 2026-06-22T07:59:00.000Z"); // model/data asOf
    expect(a).toContain("本轮数据检索时间：2026-06-22T08:00:00.000Z"); // retrieval time
  });

  it("en: localized labels", () => {
    const a = answerRecall(snapshot, "en");
    expect(a).toContain("(published 2026-06-20)");
    expect(a).toContain("Valuation model (DCF) — as of 2026-06-22T07:59:00.000Z");
    expect(a).toContain("Data retrieved at: 2026-06-22T08:00:00.000Z");
  });

  it("empty sources → defensive fallback wording", () => {
    const empty: LastAnswerSnapshot = { capturedAt: "2026-06-22T08:00:00.000Z", validData: {}, sources: [] };
    expect(answerRecall(empty, "zh")).toContain("未保留可用的来源");
    expect(answerRecall(empty, "en").toLowerCase()).toContain("no usable source metadata");
  });
});

describe("buildSnapshot — per-element filter + frozen capture", () => {
  afterEach(() => vi.useRealTimers());

  it("all-source-fail → undefined (no empty snapshot to mis-short-circuit)", () => {
    expect(buildSnapshot({ NEWS: { error: "timeout" } })).toBeUndefined();
  });

  it("empty apiData → undefined", () => {
    expect(buildSnapshot({})).toBeUndefined();
  });

  it("partial multi-ticker success → keep only succeeded elements + their sources", () => {
    const snap = buildSnapshot({
      VALUATION: [
        { ticker: "NVDA", fairValue: 100, method: "DCF" },
        { ticker: "BADTICK", error: "not found" },
      ],
    });
    expect(snap).toBeDefined();
    expect(snap!.validData.VALUATION).toHaveLength(1);
    expect(snap!.validData.VALUATION[0].ticker).toBe("NVDA");
    // one model source (NVDA), the failed element produced none
    expect(snap!.sources.filter((s) => s.type === "model")).toHaveLength(1);
  });

  it("fake-clock: capturedAt + model asOf freeze at fetch time, not recall time", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-22T08:00:00.000Z"));
    const snap = buildSnapshot({ VALUATION: { ticker: "NVDA", fairValue: 100, method: "DCF" } })!;
    // advance the clock as if a follow-up arrived 3 hours later
    vi.setSystemTime(new Date("2026-06-22T11:00:00.000Z"));
    const a = answerRecall(snap, "en");
    expect(snap.capturedAt).toBe("2026-06-22T08:00:00.000Z");
    expect(a).toContain("2026-06-22T08:00:00.000Z"); // still the fetch time
    expect(a).not.toContain("11:00:00"); // never the follow-up time
  });
});
