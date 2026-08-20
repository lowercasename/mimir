#!/bin/sh
# Consume dashboard action requests. Run from cron every minute on the host.
#
# The dashboard can only WRITE empty marker files (data/requests/<name>.request);
# this runner is the sole thing that executes, and only commands whitelisted in
# .env. Marker contents are never read — file existence is the whole protocol —
# so nothing browser-supplied can reach a shell. Per-action config in .env:
#
#   ACTION_<NAME>_CMD       command to run (name uppercased, - → _). Unset = off.
#   ACTION_<NAME>_TIMEOUT   seconds before the run is killed   (default 1800)
#   ACTION_<NAME>_COOLDOWN  min seconds between runs           (default 300)
#
# Which buttons the dashboard shows is separate (DASHBOARD_ACTIONS); an action
# is live only when both sides agree. Output goes to data/actions/<name>.log
# (host-only — NOT mounted into the dashboard, which sees only rc/timestamps
# in the state file).
set -eu

DIR=$(cd "$(dirname "$0")/.." && pwd)
RQ="$DIR/data/requests"
LOGS="$DIR/data/actions"
[ -d "$RQ" ] || exit 0
mkdir -p "$LOGS"

# One runner at a time; a second cron tick while an action runs just exits.
exec 9>"$RQ/.runner.lock"
flock -n 9 || exit 0

env_get() {
  grep -E "^$1=" "$DIR/.env" 2>/dev/null | head -1 | cut -d= -f2-
}

state() { # $1 name, $2 json body
  printf '%s\n' "$2" > "$RQ/.$1.state.tmp" && mv -f "$RQ/.$1.state.tmp" "$RQ/$1.state.json"
}

now() { date -u +%Y-%m-%dT%H:%M:%SZ; }

run_action() { # $1 name
  name="$1"
  req="$RQ/$name.request"
  [ -f "$req" ] || return 0
  rm -f "$req" # consume first: a crash must not leave a re-firing request

  var=$(printf '%s' "$name" | tr 'a-z-' 'A-Z_')
  cmd=$(env_get "ACTION_${var}_CMD")
  if [ -z "$cmd" ]; then
    state "$name" "{\"status\":\"failed\",\"rc\":127,\"finishedAt\":\"$(now)\",\"note\":\"no ACTION_${var}_CMD in .env\"}"
    return 0
  fi
  to=$(env_get "ACTION_${var}_TIMEOUT"); to="${to:-1800}"
  cool=$(env_get "ACTION_${var}_COOLDOWN"); cool="${cool:-300}"

  last=$(cat "$RQ/.$name.last" 2>/dev/null || echo 0)
  if [ $(( $(date +%s) - last )) -lt "$cool" ]; then
    state "$name" "{\"status\":\"refused-cooldown\",\"finishedAt\":\"$(now)\"}"
    return 0
  fi

  started=$(now)
  state "$name" "{\"status\":\"running\",\"startedAt\":\"$started\"}"
  rc=0
  timeout "$to" sh -c "$cmd" > "$LOGS/$name.log" 2>&1 || rc=$?
  date +%s > "$RQ/.$name.last"
  if [ "$rc" -eq 124 ]; then
    state "$name" "{\"status\":\"timeout\",\"rc\":124,\"startedAt\":\"$started\",\"finishedAt\":\"$(now)\"}"
  elif [ "$rc" -eq 0 ]; then
    state "$name" "{\"status\":\"ok\",\"rc\":0,\"startedAt\":\"$started\",\"finishedAt\":\"$(now)\"}"
  else
    state "$name" "{\"status\":\"failed\",\"rc\":$rc,\"startedAt\":\"$started\",\"finishedAt\":\"$(now)\"}"
  fi
}

# The whitelist: only names listed here are ever looked at. A stray marker
# file with any other name is deleted unexamined.
for f in "$RQ"/*.request; do
  [ -e "$f" ] || break
  base=$(basename "$f" .request)
  case "$base" in
    sync-tablet|gardener) ;;
    *) rm -f "$f" ;;
  esac
done

run_action sync-tablet
run_action gardener
