#!/usr/bin/env tsx
/**
 * Ad-hoc: run the real classifier (DeepSeek) on a query, then apply the
 * earnings coerce step, and dump BOTH the raw classification and the
 * post-coerce result — so we can see the EARNINGS topic decision end to end.
 *
 *   DEEPSEEK=1 LOG_LEVEL=error npx tsx --env-file=.env scripts/routing/dump-earnings.ts "tesla earnings call calendar"
 */
import { classifyIntents } from "../../server/agent/classifier";
import { coerceMarketEarningsCalendar } from "../../server/earnings/routing";

const NOISE = /^(ℹ️|✅|🔍|⚠️|🎯|❌ |🐞|📅|📞|📊)/;
const realLog = console.log.bind(console);
console.log = (...a: any[]) => {
  if (!(typeof a[0] === "string" && NOISE.test(a[0]))) realLog(...a);
};
console.warn = () => {};

async function main() {
  const query = process.argv[2] || "tesla earnings call calendar";
  const raw = await classifyIntents(query, [], "zh");
  realLog("\n=== QUERY ===\n" + query);
  realLog("\n=== RAW classification (DeepSeek) ===");
  realLog(JSON.stringify(raw, null, 2));

  const c: Record<string, any> = { ...raw };
  coerceMarketEarningsCalendar(c, query);
  realLog("\n=== AFTER coerceMarketEarningsCalendar ===");
  realLog(
    JSON.stringify(
      {
        primary_focus: c.primary_focus,
        required_data: c.required_data,
        tickers: c.tickers,
        intents: c.intents,
        api_params_EARNINGS: c.api_params?.EARNINGS,
      },
      null,
      2,
    ),
  );
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
