#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

# Shared defaults for the workspace (do not put secrets here).
export ROOT_DIR
export BACKEND_DIR="${BACKEND_DIR:-$ROOT_DIR/backend}"
export FRONTEND_DIR="${FRONTEND_DIR:-$ROOT_DIR/frontend}"
export SCRIPTS_DIR="${SCRIPTS_DIR:-$BACKEND_DIR/scripts}"
export VAR_DIR="${VAR_DIR:-$BACKEND_DIR/var}"
export CONFIG_DIR="${CONFIG_DIR:-$BACKEND_DIR/config}"

# npm config in sandboxed environments:
# - npm writes cache/logs under its cache dir (default: ~/.npm) which may not be writable.
# - use `npm_config_*` (lowercase) env vars (npm reads these), keeping everything inside `var/`.
export NPM_CACHE_DIR="${NPM_CACHE_DIR:-$VAR_DIR/npm-cache}"
export npm_config_cache="${npm_config_cache:-$NPM_CACHE_DIR}"
export npm_config_userconfig="${npm_config_userconfig:-$VAR_DIR/npmrc}"
export npm_config_update_notifier="${npm_config_update_notifier:-false}"
export npm_config_audit="${npm_config_audit:-false}"
export npm_config_fund="${npm_config_fund:-false}"

mkdir -p "$VAR_DIR" >/dev/null 2>&1 || true
mkdir -p "$VAR_DIR/pids" "$VAR_DIR/logs" >/dev/null 2>&1 || true
mkdir -p "$NPM_CACHE_DIR" >/dev/null 2>&1 || true

# Optional local workspace env (ignored by git)
if [[ -f "$CONFIG_DIR/workspace.local.env" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "$CONFIG_DIR/workspace.local.env"
  set +a
fi
