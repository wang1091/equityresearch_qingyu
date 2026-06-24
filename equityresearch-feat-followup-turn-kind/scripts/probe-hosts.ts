#!/usr/bin/env tsx
/**
 * Standalone upstream HOST reachability audit — for a daily EC2 cron.
 *
 * Unlike scripts/health-check.sh (which polls the RUNNING app's /api/health,
 * i.e. an end-to-end check), this needs no running app: it probes every
 * upstream's LOCAL primary AND its public nginx failover directly, reusing the
 * same probe/classify logic as the in-app health check (server/health.ts with
 * includeFailover). The two are complementary — keep both.
 *
 * Output: a ✅/⚠️/❌ table (local port + "[nginx]" rows). A ⚠️ is a redirect
 * (e.g. an nginx vhost bouncing /api/* to a login page). Exit codes:
 *   0  all reachable (⚠️ warnings allowed unless PROBE_STRICT=1)
 *   2  at least one host DOWN (or, with PROBE_STRICT=1, any ⚠️)
 *   1  unexpected error
 * On a non-zero exit it optionally POSTs $HEALTH_ALERT_WEBHOOK (same env var as
 * health-check.sh).
 *
 * Usage:
 *   npx tsx scripts/probe-hosts.ts
 *   PROBE_STRICT=1 npx tsx scripts/probe-hosts.ts        # also fail on redirects
 * Cron (daily 08:00, load .env first):
 *   0 8 * * * cd /srv/equity && set -a && . ./.env && set +a && \
 *     /usr/bin/npx tsx scripts/probe-hosts.ts >> /var/log/equity-probe.log 2>&1
 */
import { probeUpstreams, summarizeHealth, formatHealthLines } from "../server/health";

async function postAlert(reason: string): Promise<void> {
  const webhook = process.env.HEALTH_ALERT_WEBHOOK;
  if (!webhook) return;
  const host = process.env.HOSTNAME || process.env.HOST || "ec2";
  try {
    await fetch(webhook, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: `🚨 Equity host probe FAILED on ${host} — ${reason}` }),
      signal: AbortSignal.timeout(10000),
    });
    console.log("[probe-hosts] alert POSTed to HEALTH_ALERT_WEBHOOK");
  } catch {
    console.log("[probe-hosts] webhook POST failed");
  }
}

async function main(): Promise<void> {
  const results = await probeUpstreams({ includeFailover: true });
  const summary = summarizeHealth(results);

  console.log(`\n[probe-hosts] ${new Date().toISOString()}  status=${summary.status}`);
  for (const line of formatHealthLines(results)) console.log(line);

  const strict = process.env.PROBE_STRICT === "1";
  const down = results.filter((r) => r.status === "down");
  const warn = results.filter((r) => r.status === "warn");
  const failed = strict ? [...down, ...warn] : down;

  if (failed.length > 0) {
    const reason = failed.map((r) => `${r.name} (${r.status})`).join(", ");
    console.error(`[probe-hosts] FAILED — ${reason}`);
    await postAlert(reason);
    process.exit(2);
  }

  if (warn.length > 0) {
    console.log(`[probe-hosts] OK with warnings — ${warn.map((r) => r.name).join(", ")}`);
  } else {
    console.log("[probe-hosts] OK — all hosts reachable");
  }
}

main().catch((e) => {
  console.error("[probe-hosts] unexpected error:", e);
  process.exit(1);
});
