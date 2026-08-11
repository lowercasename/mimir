import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import { auditTail, httpStatus, syncStatus } from "./sources.js";
import { AuditRows, Cards, Layout, Page } from "./views.js";

const MCP_HEALTH_URL = process.env.MCP_HEALTH_URL ?? "http://vault-mcp:8420/health";
const TUNNEL_READY_URL = process.env.TUNNEL_READY_URL ?? "http://cloudflared:2000/ready";
const ALLOWED_USER = process.env.DASHBOARD_TAILSCALE_USER ?? "";
const POLL_SECONDS = Math.max(2, Number(process.env.DASHBOARD_POLL_SECONDS) || 10);
const MCP_PUBLIC_URL = process.env.MCP_PUBLIC_URL ?? "";
const OAUTH_USERNAME = process.env.OAUTH_USERNAME ?? "obsidian";

const app = new Hono();

app.use(async (c, next) => {
  c.header("Content-Security-Policy", "default-src 'self'; img-src 'self'; frame-ancestors 'none'");
  c.header("X-Content-Type-Options", "nosniff");
  c.header("Referrer-Policy", "no-referrer");
  await next();
});

app.get("/healthz", (c) => c.text("ok"));
app.use("/assets/*", serveStatic({ root: "./public", rewriteRequestPath: (p) => p.replace(/^\/assets/, "") }));

// Identity comes from the Tailscale-User-Login header that `tailscale serve`
// injects. This is only trustworthy because the port is published on host
// loopback and reached exclusively through tailscale serve — anything else on
// the host's loopback could forge the header, so keep it that way. Fail closed
// when no user is configured.
app.use(async (c, next) => {
  const user = c.req.header("tailscale-user-login") ?? "";
  if (!ALLOWED_USER || user !== ALLOWED_USER) {
    return c.text(
      ALLOWED_USER ? "forbidden" : "forbidden: DASHBOARD_TAILSCALE_USER is not configured",
      403,
    );
  }
  await next();
});

app.get("/", async (c) => {
  const [sync, mcp, tunnel, audit] = await Promise.all([
    syncStatus(),
    httpStatus(MCP_HEALTH_URL),
    httpStatus(TUNNEL_READY_URL),
    auditTail(),
  ]);
  return c.html(
    <Layout>
      <Page
        sync={sync}
        mcp={mcp}
        tunnel={tunnel}
        audit={audit}
        pollSeconds={POLL_SECONDS}
        mcpUrl={MCP_PUBLIC_URL}
        oauthUser={OAUTH_USERNAME}
      />
    </Layout>,
  );
});

app.get("/partials/cards", async (c) => {
  const [sync, mcp, tunnel] = await Promise.all([
    syncStatus(),
    httpStatus(MCP_HEALTH_URL),
    httpStatus(TUNNEL_READY_URL),
  ]);
  return c.html(<Cards sync={sync} mcp={mcp} tunnel={tunnel} pollSeconds={POLL_SECONDS} />);
});

app.get("/partials/audit", async (c) => c.html(<AuditRows audit={await auditTail()} />));

serve({ fetch: app.fetch, port: 8787, hostname: "0.0.0.0" }, (info) => {
  console.log(`mimir dashboard listening on :${info.port}`);
});
