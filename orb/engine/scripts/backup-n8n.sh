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
BACKUP_STORAGE_COPY_TRANSPORT="${BACKUP_STORAGE_COPY_TRANSPORT:-auto}"
BACKUP_PUBLISH_OWNER="${BACKUP_PUBLISH_OWNER:-}"
STALE_PARTIAL_MAX_AGE_HOURS="${STALE_PARTIAL_MAX_AGE_HOURS:-6}"
readonly MAX_STALE_PARTIAL_MAX_AGE_HOURS=8760

timestamp="$(date -u +'%Y%m%dT%H%M%SZ')"
partial="$BACKUP_ROOT/.partial-$timestamp"
dest="$BACKUP_ROOT/$timestamp"
storage_format="directory"
storage_archive_sha=""
storage_archive_sha_json="null"

case "$BACKUP_STORAGE_COPY_TRANSPORT" in
  auto|tar|rsync) ;;
  *) echo "BACKUP_STORAGE_COPY_TRANSPORT must be auto, tar or rsync." >&2; exit 1 ;;
esac

# The final runtime never walks mutable state or writes backup payloads through
# DrvFS. A Windows-owned publisher copies the verified native snapshot through
# \\wsl.localhost after this script completes.
for path in "$N8N_RUNTIME_HOME" "$N8N_STORAGE_PATH" "$BACKUP_ROOT"; do
  case "$path" in
    /mnt/?/*|/mnt/? )
      echo "Runtime backup paths must be native Linux paths; Windows publication is a separate Windows-initiated step." >&2
      exit 1
      ;;
  esac
done

for command in pg_dump pg_restore psql createdb dropdb flock sha256sum tar; do
  command -v "$command" >/dev/null 2>&1 || { echo "Missing required command: $command" >&2; exit 1; }
done
if [[ -n "$RETENTION_COUNT" ]]; then
  [[ "$RETENTION_COUNT" =~ ^[1-9][0-9]*$ ]] || { echo "RETENTION_COUNT must be a positive integer." >&2; exit 1; }
fi
if [[ -n "$BACKUP_PUBLISH_OWNER" ]]; then
  id "$BACKUP_PUBLISH_OWNER" >/dev/null 2>&1 || { echo "Backup publish owner is unavailable: $BACKUP_PUBLISH_OWNER" >&2; exit 1; }
fi
if [[ ! "$STALE_PARTIAL_MAX_AGE_HOURS" =~ ^[0-9]+$ ]]; then
  echo "STALE_PARTIAL_MAX_AGE_HOURS must be an integer between 1 and $MAX_STALE_PARTIAL_MAX_AGE_HOURS." >&2
  exit 1
fi
# Strip only leading zeroes before checking length or performing arithmetic.
# This keeps operator input such as "08" valid without allowing an
# arbitrarily long all-digit value to overflow Bash arithmetic.
stale_partial_age_leading_zeroes="${STALE_PARTIAL_MAX_AGE_HOURS%%[!0]*}"
stale_partial_age_decimal="${STALE_PARTIAL_MAX_AGE_HOURS#"$stale_partial_age_leading_zeroes"}"
stale_partial_age_decimal="${stale_partial_age_decimal:-0}"
if [[ ${#stale_partial_age_decimal} -gt 4 ]] \
  || (( 10#$stale_partial_age_decimal < 1 || 10#$stale_partial_age_decimal > MAX_STALE_PARTIAL_MAX_AGE_HOURS )); then
  echo "STALE_PARTIAL_MAX_AGE_HOURS must be an integer between 1 and $MAX_STALE_PARTIAL_MAX_AGE_HOURS." >&2
  exit 1
fi
STALE_PARTIAL_MAX_AGE_HOURS=$((10#$stale_partial_age_decimal))

mkdir -p "$(dirname "$LOCK_FILE")" "$N8N_HEALTH_DIR" "$BACKUP_ROOT"
if [[ -n "$BACKUP_PUBLISH_OWNER" && "$BACKUP_ROOT" == /var/backups/* ]]; then
  publish_path="$BACKUP_ROOT"
  while [[ "$publish_path" != "/var/backups" ]]; do
    chown "$BACKUP_PUBLISH_OWNER:$BACKUP_PUBLISH_OWNER" "$publish_path"
    chmod 0700 "$publish_path"
    publish_path="$(dirname "$publish_path")"
  done
fi
exec 9>"$LOCK_FILE"
flock -n 9 || { echo "Another Orb backup is already running." >&2; exit 1; }

prune_stale_incomplete_partials() {
  local stale_partial
  # Values are accepted as decimal digits, including operator-supplied values
  # such as "08". Force the arithmetic expansion to base 10 so Bash does not
  # interpret a leading zero as an invalid octal literal.
  local stale_after_minutes=$((10#$STALE_PARTIAL_MAX_AGE_HOURS * 60))

  while IFS= read -r -d '' stale_partial; do
    # A manifest may represent a completed payload interrupted immediately
    # before the atomic rename. Keep it for explicit recovery instead of
    # treating it as disposable temporary state.
    if [[ -e "$stale_partial/manifest.json" ]]; then
      echo "Retaining stale partial with manifest for manual recovery: $stale_partial" >&2
      continue
    fi
    echo "Pruning stale incomplete backup partial: $stale_partial"
    rm -rf -- "$stale_partial"
  done < <(
    find "$BACKUP_ROOT" -mindepth 1 -maxdepth 1 -type d -name '.partial-*' \
      -mmin "+$stale_after_minutes" -print0
  )
}

# A hard shutdown can bypass the EXIT trap below and leave a growing
# .partial-* directory forever. This runs only after the backup lock is held,
# only for old partials without a recovery manifest.
prune_stale_incomplete_partials

n8n_was_active=0
cleanup() {
  local status=$?
  rm -f "$BACKUP_MARKER"
  if [[ "$n8n_was_active" == "1" ]] && ! systemctl is-active --quiet "$RUNTIME_SERVICE"; then
    systemctl start "$RUNTIME_SERVICE" || true
  fi
  if [[ "$status" != "0" ]]; then
    rm -rf -- "$partial"
  fi
  exit "$status"
}
trap cleanup EXIT INT TERM
touch "$BACKUP_MARKER"

if [[ "$MANAGE_N8N_SERVICE" == "1" ]] && systemctl is-active --quiet "$RUNTIME_SERVICE"; then
  n8n_was_active=1
  systemctl stop "$RUNTIME_SERVICE"
fi

mkdir -p "$partial/runtime/env"

sudo -n -u postgres pg_dump --format=custom --no-owner --no-acl \
  --dbname=n8n_runtime > "$partial/n8n_runtime.dump"
sudo -n -u postgres pg_restore --list < "$partial/n8n_runtime.dump" > "$partial/n8n_runtime.restore-list.txt"

install -m 0600 "$N8N_CONFIG_PATH" "$partial/runtime/config"
install -m 0600 "$N8N_ENV_FILE" "$partial/runtime/env/n8n.env"
if [[ -f "$N8N_BUSINESS_ENV_FILE" ]]; then
  install -m 0600 "$N8N_BUSINESS_ENV_FILE" "$partial/runtime/env/n8n-business.env"
fi

if [[ "$BACKUP_STORAGE_COPY_TRANSPORT" == "rsync" ]]; then
  command -v rsync >/dev/null 2>&1 || { echo "rsync is required by BACKUP_STORAGE_COPY_TRANSPORT=rsync." >&2; exit 1; }
  mkdir -p "$partial/storage"
  rsync -a --delete "$N8N_STORAGE_PATH/" "$partial/storage/"
else
  tar -C "$N8N_STORAGE_PATH" -cf "$partial/storage.tar" .
  storage_archive_sha="$(sha256sum "$partial/storage.tar" | awk '{print $1}')"
  storage_format="tar"
  storage_archive_sha_json="\"$storage_archive_sha\""
fi

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
  if ! sudo -n -u postgres pg_restore --no-owner --no-acl --dbname="$restore_db" < "$partial/n8n_runtime.dump"; then
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
  "storageFormat": "$storage_format",
  "storageArchiveSha256": $storage_archive_sha_json,
  "restoreVerified": $restore_verified,
  "retentionDays": $RETENTION_DAYS,
  "retentionCount": ${RETENTION_COUNT:-null}
}
EOF

mv "$partial" "$dest"
chmod -R go-rwx "$dest"
if [[ -n "$BACKUP_PUBLISH_OWNER" ]]; then
  chown -R "$BACKUP_PUBLISH_OWNER:$BACKUP_PUBLISH_OWNER" "$dest"
fi

if [[ -n "$RETENTION_COUNT" ]]; then
  mapfile -t backups < <(find "$BACKUP_ROOT" -mindepth 1 -maxdepth 1 -type d ! -name '.partial-*' -printf '%T@ %p\n' | sort -nr | awk '{ $1=""; sub(/^ /, ""); print }')
  for ((index=RETENTION_COUNT; index<${#backups[@]}; index++)); do
    echo "Pruning verified superseded native backup: ${backups[$index]}"
    rm -rf -- "${backups[$index]}"
  done
else
  find "$BACKUP_ROOT" -mindepth 1 -maxdepth 1 -type d ! -name '.partial-*' -mtime +"$RETENTION_DAYS" -print -exec rm -rf {} +
fi

echo "Backup completed: $dest"
echo "database_sha256=$db_sha"
echo "executions=$execution_count workflows=$workflow_count storage_bytes=$storage_bytes transport=$BACKUP_STORAGE_COPY_TRANSPORT restore_verified=$restore_verified"
