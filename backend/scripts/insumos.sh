#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
. "$ROOT_DIR/backend/scripts/env.sh"
. "$ROOT_DIR/backend/scripts/node_pkg.sh"

INSUMOS_DIR="$ROOT_DIR/inventory"

usage() {
  cat <<EOF
SKINCOS Insumos helper

Usage: $(basename "$0") <command> [args]

Commands:
  dev               Run local wrangler dev (foreground)
  deploy            Deploy worker via wrangler
  migrate           Apply D1 migrations (default DB: skincos-db)
  import            Import Sheets -> D1 via API (requires MIGRATION_TOKEN)

Env:
  INSUMOS_D1_DB      D1 database name (default: skincos-db)
  INSUMOS_API_URL    API base (default: https://api.skincos.com.br/insumos)
  INSUMOS_MIGRATION_TOKEN  Token matching Worker secret MIGRATION_TOKEN

Examples:
  ./backend/scripts/dev.sh insumos dev
  INSUMOS_D1_DB=skincos-db ./backend/scripts/dev.sh insumos migrate
  ./backend/scripts/dev.sh insumos deploy
  INSUMOS_MIGRATION_TOKEN=... ./backend/scripts/dev.sh insumos import upsert
EOF
}

ensure_insumos_exists() {
  [[ -d "$INSUMOS_DIR" ]] || { echo "[insumos] Not found at $INSUMOS_DIR" >&2; exit 1; }
  [[ -f "$INSUMOS_DIR/package.json" ]] || { echo "[insumos] package.json not found at $INSUMOS_DIR/package.json" >&2; exit 1; }
  [[ -f "$INSUMOS_DIR/wrangler.toml" ]] || { echo "[insumos] wrangler.toml not found at $INSUMOS_DIR/wrangler.toml" >&2; exit 1; }
}

ensure_insumos_deps() {
  local lockfile="$INSUMOS_DIR/pnpm-lock.yaml"
  local state_file="${CRM_INSUMOS_DEPENDENCY_STATE_FILE:-$INSUMOS_DIR/node_modules/.skincos-pnpm-lock.sha256}"
  local lock_hash
  local recorded_hash=""
  if [[ ! -f "$lockfile" ]]; then
    echo "[insumos] pnpm-lock.yaml not found at $lockfile" >&2
    exit 1
  fi
  lock_hash="$(sha256sum "$lockfile" | awk '{print $1}')"
  [[ -f "$state_file" ]] && recorded_hash="$(tr -d '\r\n' < "$state_file")"
  if [[ ! "$lock_hash" =~ ^[a-f0-9]{64}$ ]]; then
    echo "[insumos] Could not fingerprint the locked dependency graph." >&2
    exit 1
  fi

  if [[ ! -x "$INSUMOS_DIR/node_modules/.bin/wrangler" || "$recorded_hash" != "$lock_hash" ]]; then
    echo "[insumos] Aligning inventory Worker dependencies with the locked graph (pnpm)..."
    if ! install_node_deps "$INSUMOS_DIR" ci ||
       [[ ! -x "$INSUMOS_DIR/node_modules/.bin/wrangler" ]]; then
      echo "[insumos] Inventory Worker dependency installation failed; refusing to continue with an incomplete workspace." >&2
      exit 1
    fi
    mkdir -p "$(dirname "$state_file")"
    local state_tmp="${state_file}.tmp.$$"
    printf '%s\n' "$lock_hash" > "$state_tmp"
    mv -f "$state_tmp" "$state_file"
  fi
}

cmd=${1:-help}
shift || true

ensure_insumos_exists
ensure_insumos_deps

case "$cmd" in
  dev)
    (
      cd "$INSUMOS_DIR"
      run_pnpm run dev "$@"
    )
    ;;
  deploy)
    (
      cd "$INSUMOS_DIR"
      run_pnpm run deploy "$@"
    )
    ;;
  migrate)
    db_name="${INSUMOS_D1_DB:-skincos-db}"
    (
      cd "$INSUMOS_DIR"
      run_pnpm exec wrangler d1 migrations apply "$db_name" --config wrangler.toml "$@"
    )
    ;;
  import)
    mode="${1:-upsert}"
    api_url="${INSUMOS_API_URL:-https://api.skincos.com.br/insumos}"
    token="${INSUMOS_MIGRATION_TOKEN:-}"
    if [[ -z "$token" ]]; then
      echo "[insumos] Missing INSUMOS_MIGRATION_TOKEN (must match Worker secret MIGRATION_TOKEN)" >&2
      exit 1
    fi
    echo "[insumos] Importing Sheets -> D1 via ${api_url}/admin/migrate/sheets-to-d1 (mode=${mode})"
    curl -fsS "${api_url}/admin/migrate/sheets-to-d1" \
      -H "content-type: application/json" \
      -H "x-migration-token: ${token}" \
      -d "{\"confirm\":\"MIGRATE\",\"mode\":\"${mode}\"}" | cat
    echo
    ;;
  -h|--help|help|"")
    usage
    ;;
  *)
    echo "[insumos] Unknown command: $cmd" >&2
    usage
    exit 1
    ;;
esac
