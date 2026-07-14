#!/usr/bin/env bash
set -euo pipefail

umask 077

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck disable=SC1091
source "$ROOT_DIR/scripts/lib/runtime-paths.sh"

BACKUP_ROOT="${BACKUP_ROOT:-$N8N_RUNTIME_HOME/backups/daily}"
RETENTION_DAYS="${RETENTION_DAYS:-30}"
RETENTION_COUNT="${RETENTION_COUNT:-}"
BACKUP_MARKER="${BACKUP_MARKER:-$N8N_HEALTH_DIR/backup-in-progress}"
LOCK_FILE="${LOCK_FILE:-$N8N_RUNTIME_HOME/locks/n8n-backup.lock}"
MANAGE_N8N_SERVICE="${MANAGE_N8N_SERVICE:-1}"
RUNTIME_SERVICE="${RUNTIME_SERVICE:-$SKINCOS_N8N_SERVICE}"
VERIFY_RESTORE="${VERIFY_RESTORE:-auto}"
timestamp="$(date -u +'%Y%m%dT%H%M%SZ')"
partial="$BACKUP_ROOT/.partial-$timestamp"
dest="$BACKUP_ROOT/$timestamp"

for command in pg_dump pg_restore psql createdb dropdb rsync flock sha256sum; do
  command -v "$command" >/dev/null 2>&1 || { echo "Missing required command: $command" >&2; exit 1; }
done
if [[ -n "$RETENTION_COUNT" ]]; then
  [[ "$RETENTION_COUNT" =~ ^[1-9][0-9]*$ ]] || { echo "RETENTION_COUNT must be a positive integer." >&2; exit 1; }
fi

mkdir -p "$BACKUP_ROOT" "$(dirname "$LOCK_FILE")" "$N8N_HEALTH_DIR"
exec 9>"$LOCK_FILE"
flock -n 9 || { echo "Another n8n backup is already running." >&2; exit 1; }

n8n_was_active=0
cleanup() {
  local status=$?
  rm -f "$BACKUP_MARKER"
  if [[ "$n8n_was_active" == "1" ]] && ! systemctl is-active --quiet "$RUNTIME_SERVICE"; then
    systemctl start "$RUNTIME_SERVICE" || true
  fi
  if [[ "$status" != "0" ]]; then
    rm -rf "$partial"
  fi
  exit "$status"
}
trap cleanup EXIT INT TERM
touch "$BACKUP_MARKER"

if [[ "$MANAGE_N8N_SERVICE" == "1" ]] && systemctl is-active --quiet "$RUNTIME_SERVICE"; then
  n8n_was_active=1
  systemctl stop "$RUNTIME_SERVICE"
fi

mkdir -p "$partial/runtime" "$partial/storage"

sudo -n -u postgres pg_dump --format=custom --no-owner --no-acl \
  --dbname=n8n_runtime --file="$partial/n8n_runtime.dump"
sudo -n -u postgres pg_restore --list "$partial/n8n_runtime.dump" > "$partial/n8n_runtime.restore-list.txt"

install -m 0600 "$N8N_CONFIG_PATH" "$partial/runtime/config"
cp -a "$N8N_RUNTIME_HOME/env" "$partial/runtime/env"
chmod -R go-rwx "$partial/runtime"

previous="$(find "$BACKUP_ROOT" -mindepth 1 -maxdepth 1 -type d ! -name '.partial-*' -printf '%T@ %p\n' 2>/dev/null | sort -nr | awk 'NR==1 {print $2}')"
rsync_args=(-a --delete)
if [[ -n "$previous" && -d "$previous/storage" ]]; then
  rsync_args+=(--link-dest="$previous/storage")
fi
rsync "${rsync_args[@]}" "$N8N_STORAGE_PATH/" "$partial/storage/"

db_sha="$(sha256sum "$partial/n8n_runtime.dump" | awk '{print $1}')"
execution_count="$(sudo -n -u postgres psql -d n8n_runtime -Atqc 'select count(*) from n8n_runtime.execution_entity;')"
workflow_count="$(sudo -n -u postgres psql -d n8n_runtime -Atqc 'select count(*) from n8n_runtime.workflow_entity;')"
storage_bytes="$(du -sb "$N8N_STORAGE_PATH" | awk '{print $1}')"

run_restore=0
if [[ "$VERIFY_RESTORE" == "1" ]]; then
  run_restore=1
elif [[ "$VERIFY_RESTORE" == "auto" && "$(date +%u)" == "7" ]]; then
  run_restore=1
fi

restore_verified=false
if [[ "$run_restore" == "1" ]]; then
  restore_db="n8n_restore_check_${timestamp//[^0-9]/}"
  sudo -n -u postgres createdb "$restore_db"
  if ! sudo -n -u postgres pg_restore --no-owner --no-acl --dbname="$restore_db" "$partial/n8n_runtime.dump"; then
    sudo -n -u postgres dropdb --if-exists "$restore_db"
    echo "Temporary PostgreSQL restore failed." >&2
    exit 1
  fi
  restored_workflows="$(sudo -n -u postgres psql -d "$restore_db" -Atqc 'select count(*) from n8n_runtime.workflow_entity;')"
  sudo -n -u postgres dropdb "$restore_db"
  [[ "$restored_workflows" == "$workflow_count" ]] || { echo "Restore workflow count mismatch." >&2; exit 1; }
  restore_verified=true
fi

cat > "$partial/manifest.json" <<EOF
{
  "createdAt": "$timestamp",
  "database": "n8n_runtime",
  "databaseSha256": "$db_sha",
  "executionCount": $execution_count,
  "workflowCount": $workflow_count,
  "storagePath": "$N8N_STORAGE_PATH",
  "storageBytes": $storage_bytes,
  "restoreVerified": $restore_verified,
  "retentionDays": $RETENTION_DAYS,
  "retentionCount": ${RETENTION_COUNT:-null}
}
EOF

mv "$partial" "$dest"
if [[ -n "$RETENTION_COUNT" ]]; then
  mapfile -t backups < <(find "$BACKUP_ROOT" -mindepth 1 -maxdepth 1 -type d ! -name '.partial-*' -printf '%T@ %p\n' | sort -nr | awk '{ $1=""; sub(/^ /, ""); print }')
  for ((index=RETENTION_COUNT; index<${#backups[@]}; index++)); do
    echo "Pruning verified superseded backup: ${backups[$index]}"
    rm -rf -- "${backups[$index]}"
  done
else
  find "$BACKUP_ROOT" -mindepth 1 -maxdepth 1 -type d ! -name '.partial-*' -mtime +"$RETENTION_DAYS" -print -exec rm -rf {} +
fi

echo "Backup completed: $dest"
echo "database_sha256=$db_sha"
echo "executions=$execution_count workflows=$workflow_count storage_bytes=$storage_bytes"
