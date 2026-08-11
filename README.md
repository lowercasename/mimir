# mimir

Self-hosted Obsidian vault stack: [obsidian-headless-sync-docker](https://github.com/crosbyh/obsidian-headless-sync-docker)
keeps a server-side copy of the vault in sync with Obsidian Sync, and
[obsidian-web-mcp](https://github.com/jimprosser/obsidian-web-mcp) serves that
vault over MCP so Claude (web, phone, desktop) can read and write notes from
anywhere. A small read-only dashboard shows the health of the whole thing.

```
Obsidian Sync ⇄ obsidian-sync ⇄ ./data/vault ⇄ vault-mcp ⇄ cloudflared ⇄ Claude
                     │                              │
                     └── status ──┐   ┌── audit ────┘
                                  ▼   ▼
                               dashboard  ← tailscale serve ← you
```

## Design decisions

- **Compose-glue, not forks.** Upstream images/code untouched; mimir owns only
  compose config, a thin Dockerfile for obsidian-web-mcp (which ships no image),
  and the dashboard.
- **Pinned images, deliberate updates.** Everything is pinned by tag (and digest
  where available). Updating is a reviewed commit, not a watchtower pull —
  exclude this project from any auto-updater.
- **The dashboard has no power.** Read-only by construction: two read-only
  volume mounts (sync status + audit log) and two internal HTTP health probes.
  No Docker socket in any form — even a read-only socket exposes every
  container's env (and therefore secrets) via inspect. Config changes are done
  over ssh.
- **No secrets in env.** Every secret is a file mount (`_FILE` convention), so
  nothing sensitive appears in `docker inspect`, compose config, or `.env`.
- **Sync status without log parsing.** The sync container's healthcheck doubles
  as a status emitter: on each probe it writes `ob sync-status --json` plus a
  timestamp to a shared volume (write-temp-then-rename, so reads are atomic).
  A stale timestamp is itself the "container is down" signal.
- **One public hostname.** Only `vault-mcp` is internet-reachable, via an
  outbound-only Cloudflare Tunnel; OAuth 2.0 + a bearer token guard it (see
  upstream's security model). The dashboard exists only on the tailnet.
- **Dashboard auth = Tailscale identity.** Published on host loopback only and
  fronted by `tailscale serve`, which injects `Tailscale-User-Login`; the app
  rejects any user other than `DASHBOARD_TAILSCALE_USER` and fails closed when
  unset. This is sound only while the port stays loopback-bound and reached
  through tailscale serve.

## Setup

1. `cp .env.example .env` and fill it in.
2. Create the secrets — see [secrets/README.md](secrets/README.md).
3. Create the tunnel (once, anywhere with `cloudflared`):

   ```sh
   cloudflared tunnel login
   cloudflared tunnel create mimir
   cloudflared tunnel route dns mimir mimir.example.com
   mv ~/.cloudflared/<UUID>.json secrets/cloudflared-credentials.json
   cp cloudflared/config.example.yml cloudflared/config.yml   # fill in UUID + hostname
   ```

4. Create the data dirs (audit must be writable by `PUID`):

   ```sh
   mkdir -p data/vault data/status data/audit
   ```

5. `docker compose up -d --build`, then watch `docker compose logs -f
   obsidian-sync` for the initial vault download.
6. Publish the dashboard on the tailnet, on the machine running the stack:

   ```sh
   tailscale serve --bg --https=8443 http://127.0.0.1:8787
   ```

   (Pick a port that doesn't shadow anything else listening on the machine's
   Tailscale IP — e.g. avoid 443 if a reverse proxy binds `0.0.0.0:443`.)

7. Connect Claude: add `https://mimir.example.com` as a custom connector; the
   OAuth login is `VAULT_OAUTH_USERNAME` / the `vault_oauth_password` secret.

## Operations

- **Status**: the dashboard, or `docker compose ps` (healthchecks are wired).
- **Change the synced vault**: edit `.env`, `docker compose up -d`. Deliberate
  ssh-only operation by design.
- **Update images**: bump the pin in `compose.yml` / the Dockerfile `ARG`,
  commit, `docker compose up -d --build`.
- **Device registrations**: sync state lives on a tmpfs, so each recreate of
  `obsidian-sync` registers a fresh device in Obsidian Sync — prune the device
  list occasionally.
- **Audit log**: `data/audit/mcp-audit.jsonl` records every vault mutation the
  MCP server performs (hashed token id, operation, path, checksums).
  `scripts/rotate-audit-log.sh` gzips and truncates it past 10 MiB — run it
  from cron (e.g. weekly).
- **Monitoring**: set `MCP_HEARTBEAT_URL` in `.env` to a Healthchecks.io
  (or similar) ping URL and the MCP server pushes a heartbeat every minute —
  the monitor alerts you when the pushes stop.

## Credits

Dashboard icon: ["Headless" by Konkapp](https://thenounproject.com/icon/headless-5062774/)
(Noun Project), modified to smile.

## Known upstream issues

- `obsidian-headless-sync-docker` crash-loops under `read_only: true` because
  the CLI resolves its config dir from the passwd home rather than `$HOME`
  ([#5](https://github.com/crosbyh/obsidian-headless-sync-docker/issues/5)).
  Worked around here with a tmpfs at `/home/node`; drop it when fixed upstream.
