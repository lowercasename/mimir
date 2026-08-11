# Secrets

One file per secret, `chmod 600`, never committed. All are injected as file
mounts (`_FILE` convention) so nothing secret appears in container env or
`docker inspect`.

| File | Contents | Generate with |
|------|----------|---------------|
| `obsidian_auth_token` | Obsidian Sync auth token | `docker run --rm -it ghcr.io/crosbyh/obsidian-headless-sync-docker:latest get-token` |
| `vault_mcp_token` | Bearer token MCP clients present | `python3 -c "import secrets; print(secrets.token_hex(32))"` |
| `vault_oauth_password` | Password for the OAuth browser login | `python3 -c "import secrets; print(secrets.token_urlsafe(24))"` (or a passphrase) |
| `cloudflared-credentials.json` | Tunnel credentials | `cloudflared tunnel create mimir` writes `<UUID>.json`; move it here |

```sh
chmod 600 secrets/* && chmod 644 secrets/README.md
```

No trailing newlines matter for the token files — write them with `printf '%s'`
if generating by hand.
