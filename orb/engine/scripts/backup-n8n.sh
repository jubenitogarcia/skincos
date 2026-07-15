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
ROBOCOPY_BIN="${ROBOCOPY_BIN:-}"
CERTUTIL_BIN="${CERTUTIL_BIN:-}"
WINDOWS_TAR_BIN="${WINDOWS_TAR_BIN:-}"
WINDOWS_TRANSFER_LINUX_USER="${WINDOWS_TRANSFER_LINUX_USER:-admin}"
BACKUP_NATIVE_TRANSFER_ROOT="${BACKUP_NATIVE_TRANSFER_ROOT:-/home/$WINDOWS_TRANSFER_LINUX_USER/skincos-orb-backup-transfer}"
timestamp="$(date -u +'%Y%m%dT%H%M%SZ')"
partial="$BACKUP_ROOT/.partial-$timestamp"
dest="$BACKUP_ROOT/$timestamp"
native_transfer_dir=""
storage_format="directory"
storage_archive_sha_json="null"

case "$BACKUP_STORAGE_COPY_TRANSPORT" in
  auto|robocopy|rsync) ;;
  *) echo "BACKUP_STORAGE_COPY_TRANSPORT must be auto, robocopy or rsync." >&2; exit 1 ;;
esac

for command in pg_dump pg_restore psql createdb dropdb flock sha256sum; do
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
  if [[ -n "$native_transfer_dir" ]]; then
    rm -rf "$native_transfer_dir"
  fi
  exit "$status"
}
trap cleanup EXIT INT TERM
touch "$BACKUP_MARKER"

if [[ "$MANAGE_N8N_SERVICE" == "1" ]] && systemctl is-active --quiet "$RUNTIME_SERVICE"; then
  n8n_was_active=1
  systemctl stop "$RUNTIME_SERVICE"
fi

resolve_robocopy() {
  local candidate
  if [[ -n "$ROBOCOPY_BIN" && -x "$ROBOCOPY_BIN" ]]; then
    return 0
  fi
  candidate="$(command -v robocopy.exe 2>/dev/null || true)"
  if [[ -n "$candidate" ]]; then
    ROBOCOPY_BIN="$candidate"
    return 0
  fi
  # systemd/root commonly uses a secure PATH that omits Windows interop
  # entries. The mounted Windows binary remains executable from WSL.
  for candidate in /mnt/c/Windows/System32/robocopy.exe /mnt/c/WINDOWS/system32/robocopy.exe; do
    if [[ -x "$candidate" ]]; then
      ROBOCOPY_BIN="$candidate"
      return 0
    fi
  done
  return 1
}

resolve_windows_validator() {
  local candidate
  if [[ -z "$CERTUTIL_BIN" ]]; then
    for candidate in /mnt/c/Windows/System32/certutil.exe /mnt/c/WINDOWS/system32/certutil.exe; do
      if [[ -x "$candidate" ]]; then CERTUTIL_BIN="$candidate"; break; fi
    done
  fi
  if [[ -z "$WINDOWS_TAR_BIN" ]]; then
    for candidate in /mnt/c/Windows/System32/tar.exe /mnt/c/WINDOWS/system32/tar.exe; do
      if [[ -x "$candidate" ]]; then WINDOWS_TAR_BIN="$candidate"; break; fi
    done
  fi
  [[ -n "$CERTUTIL_BIN" && -n "$WINDOWS_TAR_BIN" ]] || {
    echo "Windows certutil.exe and tar.exe are required for native storage backup transfer." >&2
    return 1
  }
}

sync_native_storage_via_windows() {
  resolve_robocopy || { echo "robocopy.exe is required for native storage backup transfer." >&2; return 1; }
  resolve_windows_validator
  command -v tar >/dev/null 2>&1 || { echo "tar is required for native storage backup transfer." >&2; return 1; }
  id "$WINDOWS_TRANSFER_LINUX_USER" >/dev/null 2>&1 || {
    echo "Windows transfer Linux user is unavailable: $WINDOWS_TRANSFER_LINUX_USER" >&2
    return 1
  }

  native_transfer_dir="$BACKUP_NATIVE_TRANSFER_ROOT/$timestamp"
  install -d -m 0700 "$native_transfer_dir"
  if [[ "$(id -u)" == "0" ]]; then
    chown "$WINDOWS_TRANSFER_LINUX_USER:$WINDOWS_TRANSFER_LINUX_USER" "$native_transfer_dir"
  elif [[ "$(id -un)" != "$WINDOWS_TRANSFER_LINUX_USER" ]]; then
    echo "Native transfer staging must run as root or $WINDOWS_TRANSFER_LINUX_USER." >&2
    return 1
  fi
  local archive="$native_transfer_dir/storage.tar"
  tar -C "$N8N_STORAGE_PATH" -cf "$archive" .
  if [[ "$(id -u)" == "0" ]]; then
    chown "$WINDOWS_TRANSFER_LINUX_USER:$WINDOWS_TRANSFER_LINUX_USER" "$archive"
  fi
  chmod 0600 "$archive"

  local source_sha source_windows destination_windows destination_file_windows destination_sha status=0
  source_sha="$(sha256sum "$archive" | awk '{print $1}')"
  # The common backup scaffold creates this directory for directory-format
  # copies. Native Linux state is stored as a tar archive instead, so do not
  # leave a misleading empty storage/ payload beside storage.tar.
  rmdir "$partial/storage"
  source_windows="$(wslpath -w "$native_transfer_dir")"
  destination_windows="$(wslpath -w "$partial")"
  destination_file_windows="${destination_windows}\\storage.tar"
  "$ROBOCOPY_BIN" "$source_windows" "$destination_windows" storage.tar /COPY:DAT /R:2 /W:1 /NFL /NDL /NJH /NJS /NP >/dev/null || status=$?
  if (( status > 7 )); then
    echo "Windows-native storage archive transfer failed with robocopy exit code $status." >&2
    return "$status"
  fi
  "$WINDOWS_TAR_BIN" -tf "$destination_file_windows" >/dev/null
  destination_sha="$("$CERTUTIL_BIN" -hashfile "$destination_file_windows" SHA256 | tr -d '\r ' | grep -E '^[0-9A-Fa-f]{64}$' | head -n1 | tr 'A-F' 'a-f')"
  [[ -n "$destination_sha" && "$destination_sha" == "$source_sha" ]] || {
    echo "Windows-native storage archive checksum mismatch." >&2
    return 1
  }

  storage_format="tar"
  storage_archive_sha_json="\"$source_sha\""
  rm -rf "$native_transfer_dir"
  native_transfer_dir=""
}

should_use_robocopy() {
  if [[ "$BACKUP_STORAGE_COPY_TRANSPORT" == "rsync" ]]; then
    return 1
  fi
  if [[ "$BACKUP_STORAGE_COPY_TRANSPORT" == "robocopy" ]]; then
    resolve_robocopy || { echo "robocopy.exe is required by BACKUP_STORAGE_COPY_TRANSPORT=robocopy." >&2; exit 1; }
    return 0
  fi
  resolve_robocopy \
    && [[ "$N8N_STORAGE_PATH" == /mnt/c/* ]] \
    && [[ "$partial" == /mnt/c/* ]]
}

sync_storage() {
  if [[ "$N8N_STORAGE_PATH" != /mnt/c/* && "$partial" == /mnt/c/* ]]; then
    sync_native_storage_via_windows
    return
  fi
  if should_use_robocopy; then
    local source_windows destination_windows status=0
    source_windows="$(wslpath -w "$N8N_STORAGE_PATH")"
    destination_windows="$(wslpath -w "$partial/storage")"
    # /MIR provides the same complete snapshot semantics as rsync --delete.
    # Unlike rsync on DrvFS, robocopy does not block the WSL service process in
    # p9_client_rpc while walking large Windows-hosted binary storage.
    "$ROBOCOPY_BIN" "$source_windows" "$destination_windows" /MIR /COPY:DAT /DCOPY:T /R:2 /W:1 /NFL /NDL /NJH /NJS /NP >/dev/null || status=$?
    if (( status > 7 )); then
      echo "robocopy failed with exit code $status while backing up n8n storage." >&2
      return "$status"
    fi
    return
  fi

  command -v rsync >/dev/null 2>&1 || { echo "rsync is required by BACKUP_STORAGE_COPY_TRANSPORT=rsync." >&2; exit 1; }
  local previous rsync_args
  previous="$(find "$BACKUP_ROOT" -mindepth 1 -maxdepth 1 -type d ! -name '.partial-*' -printf '%T@ %p\n' 2>/dev/null | sort -nr | awk 'NR==1 {print $2}')"
  rsync_args=(-a --delete)
  if [[ -n "$previous" && -d "$previous/storage" ]]; then
    rsync_args+=(--link-dest="$previous/storage")
  fi
  rsync "${rsync_args[@]}" "$N8N_STORAGE_PATH/" "$partial/storage/"
}

mkdir -p "$partial/runtime/env" "$partial/storage"

sudo -n -u postgres pg_dump --format=custom --no-owner --no-acl \
  --dbname=n8n_runtime --file="$partial/n8n_runtime.dump"
sudo -n -u postgres pg_restore --list "$partial/n8n_runtime.dump" > "$partial/n8n_runtime.restore-list.txt"

install -m 0600 "$N8N_CONFIG_PATH" "$partial/runtime/config"
install -m 0600 "$N8N_ENV_FILE" "$partial/runtime/env/n8n.env"
if [[ -f "$N8N_BUSINESS_ENV_FILE" ]]; then
  install -m 0600 "$N8N_BUSINESS_ENV_FILE" "$partial/runtime/env/n8n-business.env"
fi
chmod -R go-rwx "$partial/runtime"

sync_storage

db_sha="$(sha256sum "$partial/n8n_runtime.dump" | awk '{print $1}')"
execution_count="$(sudo -n -u postgres psql -d n8n_runtime -Atqc 'select count(*) from n8n_runtime.execution_entity;')"
workflow_count="$(sudo -n -u postgres psql -d n8n_runtime -Atqc 'select count(*) from n8n_runtime.workflow_entity;')"
storage_bytes="unavailable"
storage_bytes_json="null"
if ! should_use_robocopy; then
  storage_bytes="$(du -sb "$N8N_STORAGE_PATH" | awk '{print $1}')"
  storage_bytes_json="$storage_bytes"
fi

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
  "storageBytes": $storage_bytes_json,
  "storageFormat": "$storage_format",
  "storageArchiveSha256": $storage_archive_sha_json,
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
echo "executions=$execution_count workflows=$workflow_count storage_bytes=$storage_bytes transport=$BACKUP_STORAGE_COPY_TRANSPORT"
