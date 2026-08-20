import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import { actionStatuses, requestAction } from "./actions.js";
import { auditTail, httpStatus, syncStatus } from "./sources.js";
import { ActionRows, AuditRows, Cards, Layout, Page } from "./views.js";

const MCP_HEALTH_URL = process.env.MCP_HEALTH_URL ?? "http://vault-mcp:8420/health";
const TUNNEL_READY_URL = process.env.TUNNEL_READY_URL ?? "http://cloudflared:2000/ready";
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

app.get("/", async (c) => {
  const [sync, mcp, tunnel, audit, actions] = await Promise.all([
    syncStatus(),
    httpStatus(MCP_HEALTH_URL),
    httpStatus(TUNNEL_READY_URL),
    auditTail(),
    actionStatuses(),
  ]);
  return c.html(
    <Layout>
      <Page
        sync={sync}
        mcp={mcp}
        tunnel={tunnel}
        audit={audit}
        actions={actions}
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

app.get("/partials/actions", async (c) => c.html(<ActionRows actions={await actionStatuses()} />));

// The dashboard has no auth (the bind address is the trust boundary), so the
// only web-borne risk to guard against here is cross-site request forgery
// from a browser that can reach that bind. Requiring the HX-Request header
// blocks plain cross-site form posts (forms can't set custom headers), and a
// cross-origin fetch() adding it would need a CORS preflight we never answer.
// Sec-Fetch-Site is checked as a second signal where the browser sends it.
app.post("/actions/:name", async (c) => {
  const secFetch = c.req.header("Sec-Fetch-Site");
  if (c.req.header("HX-Request") !== "true" || (secFetch && secFetch !== "same-origin")) {
    return c.text("forbidden", 403);
  }
  const result = await requestAction(c.req.param("name"));
  if (result === "unknown") return c.text("unknown action", 404);
  // "busy" falls through: re-render shows the queued/running state either way.
  return c.html(<ActionRows actions={await actionStatuses()} />);
});

serve({ fetch: app.fetch, port: 8787, hostname: "0.0.0.0" }, (info) => {
  console.log(`mimir dashboard listening on :${info.port}`);
});
