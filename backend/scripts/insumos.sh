#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
. "$ROOT_DIR/backend/scripts/env.sh"
. "$ROOT_DIR/backend/scripts/node_pkg.sh"

INSUMOS_DIR="$ROOT_DIR/backend/apps/insumos"
INSUMOS_PKG="@skincos/insumos-worker"

usage() {
  cat <<EOF
SKINCOS Insumos helper

Usage: $(basename "$0") <command> [args]

Commands:
  dev               Run local wrangler dev (foreground)
  deploy            Deploy worker via wrangler
  migrate           Apply D1 migrations (default DB: skincos-db)

Env:
  INSUMOS_D1_DB      D1 database name (default: skincos-db)

Examples:
  ./backend/scripts/dev.sh insumos dev
  INSUMOS_D1_DB=skincos-db ./backend/scripts/dev.sh insumos migrate
  ./backend/scripts/dev.sh insumos deploy
EOF
}

ensure_insumos_exists() {
  [[ -d "$INSUMOS_DIR" ]] || { echo "[insumos] Not found at $INSUMOS_DIR" >&2; exit 1; }
  [[ -f "$INSUMOS_DIR/package.json" ]] || { echo "[insumos] package.json not found at $INSUMOS_DIR/package.json" >&2; exit 1; }
  [[ -f "$INSUMOS_DIR/wrangler.toml" ]] || { echo "[insumos] wrangler.toml not found at $INSUMOS_DIR/wrangler.toml" >&2; exit 1; }
}

ensure_backend_deps() {
  if [[ ! -d "$BACKEND_DIR/node_modules" ]]; then
    echo "[insumos] Installing backend workspace deps (pnpm)..."
    install_node_deps "$BACKEND_DIR" install >/dev/null 2>&1 || true
  fi
}

cmd=${1:-help}
shift || true

ensure_insumos_exists
ensure_backend_deps

case "$cmd" in
  dev)
    (
      cd "$BACKEND_DIR"
      run_pnpm -F "$INSUMOS_PKG" run dev "$@"
    )
    ;;
  deploy)
    (
      cd "$BACKEND_DIR"
      run_pnpm -F "$INSUMOS_PKG" run deploy "$@"
    )
    ;;
  migrate)
    db_name="${INSUMOS_D1_DB:-skincos-db}"
    (
      cd "$INSUMOS_DIR"
      run_pnpm exec wrangler d1 migrations apply "$db_name" --config wrangler.toml "$@"
    )
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
