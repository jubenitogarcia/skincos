#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
. "$ROOT_DIR/backend/scripts/env.sh"

MODE="dry-run"
VAR_DIR="${VAR_DIR:-$ROOT_DIR/backend/var}"

usage() {
  cat <<'EOF'
Usage:
  ./scripts/migrate-var.sh --dry-run
  ./scripts/migrate-var.sh --apply [--var-dir /path/to/var]

Moves selected runtime/state directories into VAR_DIR and replaces originals with symlinks.
Default is --dry-run (non-destructive).

Environment:
  VAR_DIR can also be set via --var-dir.
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry-run) MODE="dry-run"; shift ;;
    --apply) MODE="apply"; shift ;;
    --var-dir) shift; VAR_DIR="${1:-$VAR_DIR}"; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown arg: $1" >&2; usage; exit 2 ;;
  esac
done

log() { printf '%s\n' "$*"; }

ensure_dir() {
  local d="$1"
  if [[ "$MODE" == "apply" ]]; then
    mkdir -p "$d"
  fi
  return 0
}

move_and_link_dir() {
  local src="$1"
  local dest="$2"

  if [[ -L "$src" ]]; then
    log "SKIP (already symlink): ${src#$ROOT_DIR/}"
    return 0
  fi

  if [[ ! -e "$src" ]]; then
    log "SKIP (missing): ${src#$ROOT_DIR/}"
    return 0
  fi

  if [[ ! -d "$src" ]]; then
    log "SKIP (not a dir): ${src#$ROOT_DIR/}"
    return 0
  fi

  if [[ -e "$dest" ]]; then
    log "SKIP (dest exists): ${dest#$ROOT_DIR/}  (source: ${src#$ROOT_DIR/})"
    return 0
  fi

  log "MOVE: ${src#$ROOT_DIR/} -> ${dest#$ROOT_DIR/}"
  log "LINK: ${src#$ROOT_DIR/} -> ${dest#$ROOT_DIR/}"

  if [[ "$MODE" == "apply" ]]; then
    ensure_dir "$(dirname "$dest")"
    mv "$src" "$dest"
    ln -s "$dest" "$src"
  fi
}

log "Root: $ROOT_DIR"
log "VAR_DIR: ${VAR_DIR#$ROOT_DIR/}"
log "Mode: $MODE"
log ""

ensure_dir "$VAR_DIR"

# Agent Zero (a0) runtime/state
move_and_link_dir "$ROOT_DIR/backend/apps/agent-zero/tmp" "$VAR_DIR/agent-zero/tmp"
move_and_link_dir "$ROOT_DIR/backend/apps/agent-zero/logs" "$VAR_DIR/agent-zero/logs"
move_and_link_dir "$ROOT_DIR/backend/apps/agent-zero/work_dir" "$VAR_DIR/agent-zero/work_dir"
move_and_link_dir "$ROOT_DIR/backend/apps/agent-zero/storage" "$VAR_DIR/agent-zero/storage"
move_and_link_dir "$ROOT_DIR/backend/apps/agent-zero/.a0" "$VAR_DIR/agent-zero/.a0"

# WhatsApp / webjs state (repo-root conventions)
move_and_link_dir "$ROOT_DIR/.wa-sessions" "$VAR_DIR/whatsapp/wa-sessions"
move_and_link_dir "$ROOT_DIR/.wwebjs_cache" "$VAR_DIR/whatsapp/wwebjs_cache"
move_and_link_dir "$ROOT_DIR/.wwebjs_auth" "$VAR_DIR/whatsapp/wwebjs_auth"

# Chrome profiles (common patterns)
for p in "$ROOT_DIR"/.chrome_profile_* "$ROOT_DIR"/.chrome-profile*; do
  [[ -e "$p" ]] || continue
  bn="$(basename "$p")"
  move_and_link_dir "$p" "$VAR_DIR/browser/$bn"
done

# Actual server data (docker-compose default)
move_and_link_dir "$ROOT_DIR/backend/apps/actual-server/actual-data" "$VAR_DIR/actual-server/actual-data"
move_and_link_dir "$ROOT_DIR/backend/apps/actual-server/server-files" "$VAR_DIR/actual-server/server-files"
move_and_link_dir "$ROOT_DIR/backend/apps/actual-server/user-files" "$VAR_DIR/actual-server/user-files"
move_and_link_dir "$ROOT_DIR/backend/apps/actual-server/logs" "$VAR_DIR/actual-server/logs"

log ""
if [[ "$MODE" == "dry-run" ]]; then
  log "Dry-run only. Re-run with: ./scripts/migrate-var.sh --apply"
fi
