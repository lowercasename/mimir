#!/bin/sh
# Push the sync container's health to a Healthchecks.io-style monitor.
# The sync healthcheck touches data/status/healthy-at every 30s while healthy;
# this pings the check URL while that file is fresh and hits /fail once it
# goes stale, so the monitor alerts even though the dashboard is pull-only.
# Run from cron every minute on the machine hosting the stack (GNU stat).
# No-op until SYNC_HEARTBEAT_URL is set in .env.
set -eu

DIR=$(cd "$(dirname "$0")/.." && pwd)
URL=$(grep -E '^SYNC_HEARTBEAT_URL=' "$DIR/.env" 2>/dev/null | cut -d= -f2-)
[ -n "$URL" ] || exit 0

STAMP="$DIR/data/status/healthy-at"
MAX_AGE="${MAX_AGE:-120}" # 4 missed 30s probes = stale

if [ -f "$STAMP" ]; then
  age=$(( $(date +%s) - $(stat -c %Y "$STAMP") ))
else
  age=$((MAX_AGE + 1))
fi

if [ "$age" -le "$MAX_AGE" ]; then
  curl -fsS -m 10 -o /dev/null "$URL"
else
  curl -fsS -m 10 -o /dev/null "$URL/fail"
fi
