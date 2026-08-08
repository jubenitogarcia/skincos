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
  snapshot-export   Export a read-only Insumos preview snapshot from D1
  import            Import Sheets -> D1 via API (requires MIGRATION_TOKEN)

Env:
  INSUMOS_D1_DB      D1 database name (default: skincos-db)
  INSUMOS_API_URL    API base (default: https://api.skincos.com.br/insumos)
  INSUMOS_MIGRATION_TOKEN  Token matching Worker secret MIGRATION_TOKEN

Examples:
  ./backend/scripts/dev.sh insumos dev
  INSUMOS_D1_DB=skincos-db ./backend/scripts/dev.sh insumos migrate
  ./backend/scripts/insumos.sh snapshot-export /private/runtime/insumos.json
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
  local install_lock="${CRM_INSUMOS_DEPENDENCY_LOCK_FILE:-$INSUMOS_DIR/.skincos-dependencies.lock}"
  local cache_root="${CRM_INSUMOS_DEPENDENCY_CACHE_ROOT:-}"
  local lock_hash
  local manifest_hash
  local dependency_key
  if [[ ! -f "$lockfile" ]]; then
    echo "[insumos] pnpm-lock.yaml not found at $lockfile" >&2
    exit 1
  fi
  if ! command -v flock >/dev/null 2>&1; then
    echo "[insumos] flock is required to publish the locked dependency graph safely." >&2
    exit 1
  fi
  lock_hash="$(sha256sum "$lockfile" | awk '{print $1}')"
  manifest_hash="$(sha256sum "$INSUMOS_DIR/package.json" | awk '{print $1}')"
  if [[ ! "$lock_hash" =~ ^[a-f0-9]{64}$ ]]; then
    echo "[insumos] Could not fingerprint the locked dependency graph." >&2
    exit 1
  fi
  if [[ ! "$manifest_hash" =~ ^[a-f0-9]{64}$ ]]; then
    echo "[insumos] Could not fingerprint the dependency manifest." >&2
    exit 1
  fi
  dependency_key="$(
    printf 'package.json:%s\npnpm-lock.yaml:%s\n' "$manifest_hash" "$lock_hash" |
      sha256sum |
      awk '{print $1}'
  )"
  if [[ ! "$dependency_key" =~ ^[a-f0-9]{64}$ ]]; then
    echo "[insumos] Could not fingerprint the complete dependency contract." >&2
    exit 1
  fi

  mkdir -p "$(dirname "$state_file")" "$(dirname "$install_lock")"
  (
    exec 9>"$install_lock"
    flock 9

    local recorded_key=""
    [[ -f "$state_file" ]] && recorded_key="$(tr -d '\r\n' < "$state_file")"

    if [[ -z "$cache_root" ]]; then
      if [[ ! -x "$INSUMOS_DIR/node_modules/.bin/wrangler" || "$recorded_key" != "$dependency_key" ]]; then
        echo "[insumos] Aligning inventory Worker dependencies with the locked graph (pnpm)..."
        if ! install_node_deps "$INSUMOS_DIR" ci ||
           [[ ! -x "$INSUMOS_DIR/node_modules/.bin/wrangler" ]]; then
          echo "[insumos] Inventory Worker dependency installation failed; refusing to continue with an incomplete workspace." >&2
          exit 1
        fi
      fi
    else
      mkdir -p "$cache_root"
      local cache_dir="$cache_root/$dependency_key"
      local ready_file="$cache_dir/.skincos-dependency-key.sha256"
      local expected_modules="$cache_dir/node_modules"
      local quarantine_root="$cache_root/quarantine"
      local source_modules="$INSUMOS_DIR/node_modules"
      local source_modules_target=""
      local temporary=""
      local stale_candidate

      mkdir -p "$quarantine_root"
      shopt -s nullglob
      for stale_candidate in "$cache_root"/."$dependency_key".tmp.*; do
        local quarantine_candidate="$quarantine_root/$(basename "$stale_candidate").$(date +%Y%m%d-%H%M%S).$$"
        mv -- "$stale_candidate" "$quarantine_candidate"
        echo "[insumos] Preserved an interrupted dependency candidate at $quarantine_candidate." >&2
      done
      shopt -u nullglob

      if [[ ( -e "$cache_dir" || -L "$cache_dir" ) &&
            ( ! -x "$expected_modules/.bin/wrangler" ||
              ! -f "$ready_file" ||
              "$(tr -d '\r\n' < "$ready_file" 2>/dev/null || true)" != "$dependency_key" ) ]]; then
        if [[ -L "$source_modules" ]]; then
          source_modules_target="$(readlink -f "$source_modules" 2>/dev/null || true)"
        fi
        if [[ "$source_modules_target" == "$expected_modules" ]]; then
          echo "[insumos] Published dependency cache is incomplete but may still be in use; refusing to move it." >&2
          exit 1
        fi
        local quarantine_cache="$quarantine_root/${dependency_key}.$(date +%Y%m%d-%H%M%S).$$"
        mv -- "$cache_dir" "$quarantine_cache"
        echo "[insumos] Preserved an incomplete unpublished dependency cache at $quarantine_cache." >&2
      fi

      if [[ ! -d "$cache_dir" ]]; then
        temporary="$(mktemp -d "$cache_root/.${dependency_key}.tmp.XXXXXX")"
        if ! cp -- "$INSUMOS_DIR/package.json" "$lockfile" "$temporary/" ||
           ! install_node_deps "$temporary" ci ||
           [[ ! -x "$temporary/node_modules/.bin/wrangler" ]]; then
          echo "[insumos] Inventory Worker dependency installation failed; the unpublished candidate will be quarantined on retry." >&2
          exit 1
        fi
        printf '%s\n' "$dependency_key" > "$temporary/.skincos-dependency-key.sha256"
        mv -- "$temporary" "$cache_dir"
        temporary=""
      fi

      if [[ -e "$source_modules" || -L "$source_modules" ]]; then
        if [[ ! -L "$source_modules" ||
              "$(readlink -f "$source_modules" 2>/dev/null || true)" != "$expected_modules" ]]; then
          echo "[insumos] inventory/node_modules is not the expected private cache link; refusing to replace a tree that may be in use." >&2
          exit 1
        fi
      else
        local source_link="${source_modules}.crm-local.$$"
        ln -s "$expected_modules" "$source_link"
        if ! mv -T -- "$source_link" "$source_modules" 2>/dev/null; then
          rm -f -- "$source_link"
          if [[ ! -L "$source_modules" ||
                "$(readlink -f "$source_modules" 2>/dev/null || true)" != "$expected_modules" ]]; then
            echo "[insumos] Another launcher published an incompatible dependency link." >&2
            exit 1
          fi
        fi
      fi
    fi

    local state_tmp="${state_file}.tmp.$$"
    printf '%s\n' "$dependency_key" > "$state_tmp"
    mv -f "$state_tmp" "$state_file"
  )
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
  snapshot-export)
    INSUMOS_D1_CONFIG="$INSUMOS_DIR/wrangler.toml" \
      INSUMOS_D1_MIGRATIONS_DIR="$INSUMOS_DIR/migrations" \
      node "$ROOT_DIR/backend/scripts/insumos-d1-export.cjs" "$@"
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
