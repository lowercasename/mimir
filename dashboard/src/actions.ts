import { readFile, rename, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";

// Dashboard actions are REQUESTS, not executions. Pressing a button writes an
// empty marker file (`<name>.request`) into REQUESTS_DIR; a host-side cron
// runner (scripts/run-requests.sh) consumes the marker and runs a command
// whitelisted in the host's .env. The marker's *existence* is the entire
// protocol — its contents are never read — so no browser-supplied data can
// reach a shell. The dashboard itself still executes nothing.
const REQUESTS_DIR = process.env.REQUESTS_DIR ?? "/requests";

// Actions are opt-in via DASHBOARD_ACTIONS (comma-separated). Unset = no
// actions panel at all, preserving the read-only default.
const ENABLED = (process.env.DASHBOARD_ACTIONS ?? "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

// The dashboard only knows how to *describe* these; what they run is defined
// host-side. An enabled name outside this map is ignored.
const META: Record<string, { label: string; desc: string }> = {
  "sync-tablet": {
    label: "Mirror tablet",
    desc: "Pull reMarkable notebook pages into the vault",
  },
  gardener: {
    label: "Run Gardener",
    desc: "Trigger a live triage run now",
  },
};

// A "running" state older than this is assumed to be a crashed runner (it
// writes a terminal state even on timeout). Unblocks the button.
const RUNNING_STALE_MS = 2 * 60 * 60 * 1000;

export type ActionPhase = "idle" | "queued" | "running";

export interface ActionStatus {
  name: string;
  label: string;
  desc: string;
  phase: ActionPhase;
  /** Human summary of the last completed run, if any. */
  last: string;
  lastOk: boolean | null;
}

interface StateFile {
  status?: string; // running | ok | failed | timeout | refused-cooldown
  startedAt?: string;
  finishedAt?: string;
  rc?: number;
}

const NAME_RE = /^[a-z][a-z0-9-]{0,32}$/;

function valid(name: string): boolean {
  return NAME_RE.test(name) && ENABLED.includes(name) && name in META;
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function readState(name: string): Promise<StateFile | null> {
  try {
    return JSON.parse(await readFile(join(REQUESTS_DIR, `${name}.state.json`), "utf8"));
  } catch {
    return null;
  }
}

function describeLast(s: StateFile | null): { last: string; lastOk: boolean | null } {
  if (!s || !s.status || s.status === "running") return { last: "never run", lastOk: null };
  const when = s.finishedAt ? relative(new Date(s.finishedAt)) : "?";
  switch (s.status) {
    case "ok":
      return { last: `ok · ${when}`, lastOk: true };
    case "timeout":
      return { last: `timed out · ${when}`, lastOk: false };
    case "refused-cooldown":
      return { last: `refused (cooldown) · ${when}`, lastOk: false };
    default:
      return { last: `failed (rc ${s.rc ?? "?"}) · ${when}`, lastOk: false };
  }
}

export async function actionStatuses(): Promise<ActionStatus[]> {
  const out: ActionStatus[] = [];
  for (const name of ENABLED) {
    if (!valid(name)) continue;
    const meta = META[name];
    const state = await readState(name);
    let phase: ActionPhase = "idle";
    if (await exists(join(REQUESTS_DIR, `${name}.request`))) {
      phase = "queued";
    } else if (state?.status === "running" && state.startedAt) {
      const age = Date.now() - new Date(state.startedAt).getTime();
      if (age < RUNNING_STALE_MS) phase = "running";
    }
    out.push({ name, ...meta, phase, ...describeLast(state) });
  }
  return out;
}

export type RequestResult = "ok" | "unknown" | "busy";

export async function requestAction(name: string): Promise<RequestResult> {
  if (!valid(name)) return "unknown";
  const statuses = await actionStatuses();
  const st = statuses.find((s) => s.name === name);
  if (!st || st.phase !== "idle") return "busy";
  // Marker content is a timestamp for humans debugging; the runner ignores it.
  const tmp = join(REQUESTS_DIR, `.${name}.request.tmp`);
  await writeFile(tmp, `${new Date().toISOString()}\n`);
  await rename(tmp, join(REQUESTS_DIR, `${name}.request`));
  return "ok";
}

export function anyActionsEnabled(): boolean {
  return ENABLED.some((n) => valid(n));
}

function relative(d: Date): string {
  const s = Math.round((Date.now() - d.getTime()) / 1000);
  if (s < 90) return `${s}s ago`;
  if (s < 5400) return `${Math.round(s / 60)}m ago`;
  return `${Math.round(s / 3600)}h ago`;
}
