import { readFile, stat, open } from "node:fs/promises";
import { join } from "node:path";

const STATUS_DIR = process.env.STATUS_DIR ?? "/status";
const AUDIT_LOG = process.env.AUDIT_LOG ?? "/data/audit/mcp-audit.jsonl";

// A probe older than this is treated as "not reporting" — the sync healthcheck
// fires every 30s, so 3 missed probes means the container is down or wedged.
const SYNC_STALE_MS = 100_000;

export type ServiceState = "ok" | "down" | "unknown";

export interface SyncStatus {
  state: ServiceState;
  detail: string;
  lastProbe: Date | null;
  config: Record<string, unknown> | null;
}

export interface HttpStatus {
  state: ServiceState;
  detail: string;
}

export interface AuditEntry {
  timestamp: string;
  operation: string;
  target_path: string;
  operation_status: string;
  client_id: string | null;
}

async function mtime(path: string): Promise<Date | null> {
  try {
    return (await stat(path)).mtime;
  } catch {
    return null;
  }
}

export async function syncStatus(): Promise<SyncStatus> {
  const healthyAt = await mtime(join(STATUS_DIR, "healthy-at"));
  const unhealthyAt = await mtime(join(STATUS_DIR, "unhealthy-at"));

  let config: Record<string, unknown> | null = null;
  try {
    config = JSON.parse(await readFile(join(STATUS_DIR, "sync.json"), "utf8"));
  } catch {
    // absent or mid-write; the timestamps below still tell the story
  }

  const lastProbe =
    healthyAt && unhealthyAt
      ? healthyAt > unhealthyAt
        ? healthyAt
        : unhealthyAt
      : (healthyAt ?? unhealthyAt);

  if (!lastProbe) {
    return { state: "unknown", detail: "no probe data yet", lastProbe, config };
  }
  if (Date.now() - lastProbe.getTime() > SYNC_STALE_MS) {
    return { state: "down", detail: "status stale — container down?", lastProbe, config };
  }
  if (unhealthyAt && (!healthyAt || unhealthyAt > healthyAt)) {
    return { state: "down", detail: "healthcheck failing", lastProbe, config };
  }
  return { state: "ok", detail: "syncing", lastProbe, config };
}

export async function httpStatus(url: string): Promise<HttpStatus> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(2500) });
    return res.ok
      ? { state: "ok", detail: `HTTP ${res.status}` }
      : { state: "down", detail: `HTTP ${res.status}` };
  } catch {
    return { state: "down", detail: "unreachable" };
  }
}

// Read only the tail of the audit log — it grows unbounded and we never need
// more than the last screenful.
export async function auditTail(limit = 25): Promise<AuditEntry[]> {
  let fh;
  try {
    fh = await open(AUDIT_LOG, "r");
  } catch {
    return [];
  }
  try {
    const size = (await fh.stat()).size;
    const span = Math.min(size, 64 * 1024);
    const { buffer } = await fh.read(Buffer.alloc(span), 0, span, size - span);
    const lines = buffer.toString("utf8").split("\n").filter(Boolean);
    if (size > span) lines.shift(); // first line may be truncated
    return lines
      .slice(-limit)
      .reverse()
      .flatMap((line) => {
        try {
          const r = JSON.parse(line);
          return [
            {
              timestamp: r.timestamp ?? "?",
              operation: r.operation ?? "?",
              target_path: r.target_path ?? "?",
              operation_status: r.operation_status ?? "?",
              client_id: r.client_id ?? null,
            },
          ];
        } catch {
          return [];
        }
      });
  } finally {
    await fh.close();
  }
}
