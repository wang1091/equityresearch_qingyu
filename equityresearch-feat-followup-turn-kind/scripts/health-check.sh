#!/usr/bin/env bash
#
# Post-start / on-demand health check for the Equity app's GET /api/health.
#
# Polls with retry to ride out the startup race (the app starts listening before
# its upstreams are necessarily ready), then decides on the route's own contract:
#   HTTP 200        → healthy (status "ok" or "degraded")        → exit 0
#   HTTP 503        → a CRITICAL upstream is down (classifier /   → keep retrying,
#                     smartnews)                                     then alert
#   no response     → app not listening yet                       → keep retrying,
#                                                                     then alert
#
# On failure it prints the last /api/health body, optionally POSTs to
# $HEALTH_ALERT_WEBHOOK, and exits non-zero (so systemd / pm2 mark it failed).
# Process-manager agnostic: call it from an ExecStartPost / oneshot unit, a pm2
# one-shot app, a deploy hook, or cron.
#
# Config (all optional, sane defaults):
#   PORT                  app port (default 5003)
#   HEALTH_HOST           host (default 127.0.0.1)
#   HEALTH_URL            full URL (overrides HOST/PORT)
#   HEALTH_RETRIES        attempts before giving up (default 12)
#   HEALTH_INTERVAL       seconds between attempts (default 5)  → ~60s window
#   HEALTH_CURL_TIMEOUT   per-request timeout seconds (default 10)
#   HEALTH_ALERT_WEBHOOK  Slack/钉钉-style webhook; if set, POSTed on failure
#
# Usage:
#   scripts/health-check.sh
#   PORT=5003 scripts/health-check.sh
#   HEALTH_RETRIES=1 HEALTH_INTERVAL=0 scripts/health-check.sh   # single shot
set -uo pipefail

PORT="${PORT:-5003}"
HOST="${HEALTH_HOST:-127.0.0.1}"
URL="${HEALTH_URL:-http://${HOST}:${PORT}/api/health}"
RETRIES="${HEALTH_RETRIES:-12}"
INTERVAL="${HEALTH_INTERVAL:-5}"
CURL_TIMEOUT="${HEALTH_CURL_TIMEOUT:-10}"
WEBHOOK="${HEALTH_ALERT_WEBHOOK:-}"

log() { printf '%s [health-check] %s\n' "$(date -u +%FT%TZ)" "$*"; }

body_file="$(mktemp)"
trap 'rm -f "$body_file"' EXIT

last_code="000"
attempt=0
while [ "$attempt" -lt "$RETRIES" ]; do
  attempt=$((attempt + 1))

  # curl exits non-zero on connection failure (prints "000"); normalize to 000.
  if ! code="$(curl -s -o "$body_file" -w '%{http_code}' --max-time "$CURL_TIMEOUT" "$URL")"; then
    code="000"
  fi
  last_code="$code"

  if [ "$code" = "200" ]; then
    status="$(grep -o '"status":"[a-z]*"' "$body_file" 2>/dev/null | head -1 | cut -d'"' -f4)"
    log "OK (HTTP 200, status=${status:-unknown}) after ${attempt} attempt(s): $URL"
    if [ "$status" = "degraded" ]; then
      log "note: degraded — non-critical upstream(s) down; see body:"
      cat "$body_file" 2>/dev/null && echo
    fi
    exit 0
  fi

  if [ "$code" = "000" ]; then
    log "attempt ${attempt}/${RETRIES}: no response at $URL (app not listening yet?)"
  else
    log "attempt ${attempt}/${RETRIES}: HTTP ${code} (critical upstream down?)"
  fi
  [ "$attempt" -lt "$RETRIES" ] && [ "$INTERVAL" -gt 0 ] && sleep "$INTERVAL"
done

# ── failed: window exhausted ──
window=$((RETRIES * INTERVAL))
reason="HTTP ${last_code}"
[ "$last_code" = "000" ] && reason="no response (app not listening)"
log "FAILED after ${RETRIES} attempt(s) over ~${window}s — ${reason}"
log "last /api/health body:"
cat "$body_file" 2>/dev/null || true
echo

if [ -n "$WEBHOOK" ]; then
  text="🚨 Equity app health check FAILED on $(hostname) — ${URL}: ${reason}"
  payload="$(printf '{"text":"%s"}' "$text")"
  if curl -s -m 10 -X POST -H 'Content-Type: application/json' -d "$payload" "$WEBHOOK" >/dev/null 2>&1; then
    log "alert POSTed to HEALTH_ALERT_WEBHOOK"
  else
    log "webhook POST failed"
  fi
fi

exit 1
