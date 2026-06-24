// Card-fixture capture facility (test tooling, not used in normal operation).
//
// When DUMP_CARD_FIXTURES is set, dumpCardFixture() writes the exact apiData
// that reaches formatDataAsCard to server/agent/__fixtures__/cards/. Those JSON
// files are the golden inputs for the cardFormatter snapshot tests (and the
// safety net for splitting cardFormatter.ts into per-source modules).
//
// Regenerate the fixtures:
//   1. DUMP_CARD_FIXTURES=1 npm run dev        # boot server with capture on
//   2. BASE_URL=http://127.0.0.1:<port> npm run fixtures:cards   # fire the battery
// (<port> is printed in the dev log, e.g. "listening on 0.0.0.0:5003")
import { mkdirSync, writeFileSync } from "node:fs";

const FIXTURE_DIR = `${process.cwd()}/server/agent/__fixtures__/cards`;

export function dumpCardFixture(
  dataSource: string,
  language: string,
  apiData: unknown,
): void {
  if (!process.env.DUMP_CARD_FIXTURES) return;
  try {
    mkdirSync(FIXTURE_DIR, { recursive: true });
    const topic =
      apiData && typeof apiData === "object" && "topic" in apiData
        ? `_${(apiData as { topic?: string }).topic}`
        : "";
    writeFileSync(
      `${FIXTURE_DIR}/${dataSource}${topic}_${language}.json`,
      JSON.stringify({ dataSource, language, apiData }, null, 2),
    );
  } catch {
    // best-effort dev tooling — never disrupt a real request
  }
}
