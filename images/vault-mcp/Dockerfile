# obsidian-web-mcp, packaged. Upstream ships no image, so this thin layer
# installs the pinned release and adds _FILE secret resolution — upstream code
# is untouched.
FROM python:3.12-slim

# Pinned to a main-branch commit: the v0.2.0 tag predates the security config
# this deployment depends on (/health, VAULT_MCP_PUBLIC_URL host pinning,
# VAULT_MCP_FORWARDED_ALLOW_IPS — hardcoded to "*" in v0.2.0 — and the audit
# log). Move back to a release tag when upstream cuts one.
ARG OBSIDIAN_WEB_MCP_VERSION=cd88fdf06e36b7003abfe05f70dc658e315d9001

# ripgrep accelerates vault_search; upstream falls back to Python without it.
RUN apt-get update \
    && apt-get install -y --no-install-recommends ripgrep \
    && rm -rf /var/lib/apt/lists/*

# mcp pinned <2: the 2.0 SDK removed the mcp.server.fastmcp module path that
# obsidian-web-mcp v0.2.0 imports (upstream declares only >=1.9.0).
RUN pip install --no-cache-dir \
    "mcp[cli]>=1.9.0,<2" \
    "obsidian-web-mcp @ https://github.com/jimprosser/obsidian-web-mcp/archive/${OBSIDIAN_WEB_MCP_VERSION}.tar.gz"

RUN groupadd -g 1000 vault && useradd -u 1000 -g 1000 -m vault

COPY entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod 755 /usr/local/bin/entrypoint.sh

USER 1000:1000
EXPOSE 8420
ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
CMD ["vault-mcp"]
