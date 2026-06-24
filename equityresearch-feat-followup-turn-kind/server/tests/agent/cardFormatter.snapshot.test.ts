// Golden snapshot tests for cardFormatter — the regression net for splitting
// cardFormatter.ts into per-source modules. Each fixture in __fixtures__/cards/
// is fed through formatDataAsCard; the rendered HTML is snapshotted. The split
// is a pure code move, so every snapshot MUST stay byte-identical.
//
// Determinism: a few formatters fall back to `new Date()` / use toLocaleString
// when a payload omits a timestamp, so we pin the clock (fake timers) and the
// timezone (TZ=UTC) before rendering.
process.env.TZ = "UTC";

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { formatDataAsCard } from "../../agent/cardFormatter";

const FIXTURE_DIR = join(__dirname, "..", "..", "agent", "__fixtures__", "cards");

const fixtures = readdirSync(FIXTURE_DIR)
  .filter((f) => f.endsWith(".json"))
  .sort();

beforeAll(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-06-16T12:00:00Z"));
});

afterAll(() => {
  vi.useRealTimers();
});

describe("cardFormatter golden snapshots", () => {
  it("captured at least the core card types", () => {
    // Guard against an empty/missing fixture dir silently passing.
    expect(fixtures.length).toBeGreaterThanOrEqual(10);
  });

  for (const file of fixtures) {
    it(`renders ${file} unchanged`, () => {
      const { dataSource, language, apiData } = JSON.parse(
        readFileSync(join(FIXTURE_DIR, file), "utf8"),
      );
      const html = formatDataAsCard(dataSource, apiData, language);
      expect(html).toMatchSnapshot();
    });
  }
});
