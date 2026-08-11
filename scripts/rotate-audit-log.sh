#!/bin/sh
# Rotate the MCP audit log when it exceeds MAX_BYTES: keep one gzipped
# generation, then truncate in place (the server appends per write, so
# truncation is safe; at worst a write landing mid-rotation is lost).
# Cron-friendly: silent when nothing to do.
set -eu

LOG="${1:-$(dirname "$0")/../data/audit/mcp-audit.jsonl}"
MAX_BYTES="${MAX_BYTES:-10485760}" # 10 MiB

[ -f "$LOG" ] || exit 0
size=$(wc -c < "$LOG")
[ "$size" -gt "$MAX_BYTES" ] || exit 0

gzip -c "$LOG" > "$LOG.1.gz.tmp"
mv -f "$LOG.1.gz.tmp" "$LOG.1.gz"
: > "$LOG"
echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) rotated $LOG ($size bytes)"
