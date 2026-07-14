#!/bin/bash
set -euo pipefail

# shellcheck disable=SC1091
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib/runtime-paths.sh"

umask 077

ARCHIVE_ROOT="${ARCHIVE_ROOT:-$N8N_RUNTIME_HOME/log-archive}"
RETENTION_DAYS="${RETENTION_DAYS:-3}"
MAX_SIZE_BYTES="${MAX_SIZE_BYTES:-10485760}"

LOG_FILES=(
    "$N8N_ROOT/n8n.log"
    "$N8N_ROOT/n8n.error.log"
    "$N8N_ROOT/launchd-n8n-evolution.out.log"
    "$N8N_ROOT/launchd-n8n-evolution.err.log"
    "$N8N_ROOT/evolution-api.log"
    "$N8N_ROOT/evolution-api.error.log"
    "$N8N_HEALTH_DIR/whatsapp-watchdog.log"
    "$N8N_HEALTH_DIR/network-fallback.err.log"
    "$N8N_HEALTH_DIR/keepawake.out.log"
)

mkdir -p "$ARCHIVE_ROOT"

rotate_file() {
    local file="$1"
    if [ ! -f "$file" ]; then
        return 0
    fi
    local size
    if stat --version >/dev/null 2>&1; then
        size=$(stat -c %s "$file")
    else
        size=$(stat -f%z "$file")
    fi
    if [ "$size" -lt "$MAX_SIZE_BYTES" ]; then
        return 0
    fi
    local base
    base="$(basename "$file")"
    local ts
    ts="$(date +"%Y%m%d-%H%M%S")"
    local archive="${ARCHIVE_ROOT}/${base}.${ts}.bak"
    cp -f "$file" "$archive"
    : > "$file"
    if command -v gzip >/dev/null 2>&1; then
        gzip -f "$archive"
    fi
}

for file in "${LOG_FILES[@]}"; do
    rotate_file "$file"
done

for file in "$N8N_STATE_HOME"/n8nEventLog*.log; do
    rotate_file "$file"
done

find "$ARCHIVE_ROOT" -type f -mtime +"$RETENTION_DAYS" -print -delete

echo "Rotacao concluida."
