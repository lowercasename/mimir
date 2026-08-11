#!/bin/sh
set -eu

# Resolve VAR_FILE -> VAR (Docker secrets convention), mirroring the sync
# image's behaviour so secrets never appear in `docker inspect`.
file_env() {
  _var="$1"
  eval "_val=\${${_var}:-}"
  eval "_fval=\${${_var}_FILE:-}"
  if [ -n "$_val" ] && [ -n "$_fval" ]; then
    echo "ERROR: both ${_var} and ${_var}_FILE are set — use one." >&2
    exit 1
  fi
  if [ -n "$_fval" ]; then
    if [ ! -r "$_fval" ]; then
      echo "ERROR: ${_var}_FILE points to an unreadable file." >&2
      exit 1
    fi
    eval "${_var}=\$(cat \"\$_fval\")"
    export "${_var?}"
  fi
}

file_env VAULT_MCP_TOKEN
file_env VAULT_OAUTH_PASSWORD
file_env VAULT_OAUTH_CLIENT_SECRET

exec "$@"
