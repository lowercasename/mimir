import type { FC, PropsWithChildren } from "hono/jsx";
import type { AuditEntry, HttpStatus, ServiceState, SyncStatus } from "./sources.js";

export const Layout: FC<PropsWithChildren> = ({ children }) => (
  <html lang="en">
    <head>
      <meta charset="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <title>mimir</title>
      <link rel="icon" type="image/svg+xml" href="/assets/icon.svg" />
      <link rel="stylesheet" href="/assets/styles.css" />
      <script src="/assets/htmx.min.js" defer></script>
      <script src="/assets/app.js" defer></script>
    </head>
    <body class="min-h-screen bg-obsidian text-ink antialiased">
      <main class="mx-auto max-w-3xl px-6 py-10">
        <header class="mb-8 flex items-baseline justify-between">
          <h1 class="flex items-center gap-2 text-xl font-semibold tracking-tight text-accent">
            <img src="/assets/icon.svg" alt="" class="h-6 w-6" />
            mimir
          </h1>
          <span class="text-xs text-faint">vault stack · read-only</span>
        </header>
        {children}
      </main>
    </body>
  </html>
);

const Dot: FC<{ state: ServiceState }> = ({ state }) => (
  <span
    class={
      state === "ok"
        ? "inline-block h-2 w-2 rounded-full bg-accent"
        : state === "down"
          ? "inline-block h-2 w-2 rounded-full bg-danger"
          : "inline-block h-2 w-2 rounded-full bg-faint"
    }
  />
);

const Card: FC<PropsWithChildren<{ title: string; state: ServiceState; detail: string }>> = ({
  title,
  state,
  detail,
  children,
}) => (
  <section class="rounded-lg border border-edge bg-panel p-4">
    <div class="flex items-center gap-2">
      <Dot state={state} />
      <h2 class="text-sm font-medium">{title}</h2>
      <span class={`ml-auto text-xs ${state === "down" ? "text-danger" : "text-faint"}`}>
        {detail}
      </span>
    </div>
    {children}
  </section>
);

// Polled fragment: the three status cards plus the freshness stamp. Swapped
// wholesale on every poll — contains no client-side state worth preserving.
export const Cards: FC<{
  sync: SyncStatus;
  mcp: HttpStatus;
  tunnel: HttpStatus;
  pollSeconds: number;
}> = ({ sync, mcp, tunnel, pollSeconds }) => (
  <div>
    <div class="grid gap-4 sm:grid-cols-3">
      <Card title="Sync" state={sync.state} detail={sync.detail}>
        <dl class="mt-3 space-y-1 text-xs text-faint">
          <div class="flex justify-between">
            <dt>Vault</dt>
            <dd class="text-ink">{String(sync.config?.vaultName ?? "—")}</dd>
          </div>
          <div class="flex justify-between">
            <dt>Mode</dt>
            <dd class="text-ink">{String(sync.config?.syncMode ?? "—")}</dd>
          </div>
          <div class="flex justify-between">
            <dt>Last probe</dt>
            <dd class="text-ink">{sync.lastProbe ? relative(sync.lastProbe) : "never"}</dd>
          </div>
        </dl>
      </Card>
      <Card title="MCP" state={mcp.state} detail={mcp.detail} />
      <Card title="Tunnel" state={tunnel.state} detail={tunnel.detail} />
    </div>
    <p class="mt-2 flex items-center justify-end gap-2 text-xs text-faint">
      <span class="poll-track" aria-hidden="true">
        <span class="poll-fill" data-poll-duration={pollSeconds}></span>
      </span>
      updated {new Date().toISOString().slice(11, 19)}Z
    </p>
  </div>
);

// Polled fragment: table contents only, so the surrounding collapsible (and
// its Alpine open/closed state) is never replaced.
export const AuditRows: FC<{ audit: AuditEntry[] }> = ({ audit }) =>
  audit.length === 0 ? (
    <p class="py-2 text-xs text-faint">No mutations recorded.</p>
  ) : (
    <table class="w-full text-left text-xs">
      <tbody>
        {audit.map((entry) => (
          <tr class="border-b border-edge/50 last:border-0">
            <td class="py-1.5 pr-3 whitespace-nowrap text-faint">
              {entry.timestamp.slice(0, 19).replace("T", " ")}
            </td>
            <td class="py-1.5 pr-3 text-accent">{entry.operation}</td>
            <td class="max-w-0 truncate py-1.5 pr-3">{entry.target_path}</td>
            <td
              class={`py-1.5 ${entry.operation_status === "success" ? "text-faint" : "text-danger"}`}
            >
              {entry.operation_status}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );

export const ConnectPanel: FC<{ mcpUrl: string; oauthUser: string }> = ({
  mcpUrl,
  oauthUser,
}) =>
  mcpUrl ? (
    <section class="rounded-lg border border-edge bg-panel px-4 py-3">
      <div class="flex items-center justify-between text-sm font-medium">
        Connect a client
        <span class="text-xs text-faint">MCP endpoint</span>
      </div>
      <div class="mt-2 flex items-center gap-2">
        <code class="flex-1 truncate rounded border border-edge bg-obsidian px-2 py-1 text-xs">
          {mcpUrl}
        </code>
        <button
          type="button"
          class="rounded border border-edge px-2 py-1 text-xs text-faint hover:border-accent hover:text-accent"
          data-copy={mcpUrl}
        >
          copy
        </button>
      </div>
      <p class="mt-2 text-xs text-faint">
        Claude → Settings → Connectors → add custom connector with this URL. Sign in as{" "}
        <code class="text-ink">{oauthUser}</code> with the{" "}
        <code class="text-ink">vault_oauth_password</code> secret. Unauthenticated requests
        are rejected by design.
      </p>
    </section>
  ) : null;

export const Page: FC<{
  sync: SyncStatus;
  mcp: HttpStatus;
  tunnel: HttpStatus;
  audit: AuditEntry[];
  pollSeconds: number;
  mcpUrl: string;
  oauthUser: string;
}> = ({ sync, mcp, tunnel, audit, pollSeconds, mcpUrl, oauthUser }) => (
  <div class="space-y-4">
    <div hx-get="/partials/cards" hx-trigger={`every ${pollSeconds}s`} hx-swap="innerHTML">
      <Cards sync={sync} mcp={mcp} tunnel={tunnel} pollSeconds={pollSeconds} />
    </div>

    <ConnectPanel mcpUrl={mcpUrl} oauthUser={oauthUser} />

    <section class="rounded-lg border border-edge bg-panel">
      <div class="flex items-center justify-between px-4 py-3 text-sm font-medium">
        Recent MCP activity
        <span class="text-xs text-faint">latest 25</span>
      </div>
      <div
        class="border-t border-edge px-4 py-2"
        hx-get="/partials/audit"
        hx-trigger={`every ${pollSeconds * 3}s`}
        hx-swap="innerHTML"
      >
        <AuditRows audit={audit} />
      </div>
    </section>
  </div>
);

function relative(d: Date): string {
  const s = Math.round((Date.now() - d.getTime()) / 1000);
  if (s < 90) return `${s}s ago`;
  if (s < 5400) return `${Math.round(s / 60)}m ago`;
  return `${Math.round(s / 3600)}h ago`;
}
