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
POWERSHELL_BIN="${POWERSHELL_BIN:-}"
WINDOWS_TRANSFER_LINUX_USER="${WINDOWS_TRANSFER_LINUX_USER:-admin}"
BACKUP_NATIVE_TRANSFER_ROOT="${BACKUP_NATIVE_TRANSFER_ROOT:-/home/$WINDOWS_TRANSFER_LINUX_USER/skincos-orb-backup-transfer}"
timestamp="$(date -u +'%Y%m%dT%H%M%SZ')"
partial="$BACKUP_ROOT/.partial-$timestamp"
dest="$BACKUP_ROOT/$timestamp"
native_transfer_dir=""
native_windows_transfer=0
storage_format="directory"
storage_archive_sha=""
storage_archive_sha_json="null"

if [[ "$N8N_STORAGE_PATH" != /mnt/c/* && "$BACKUP_ROOT" == /mnt/c/* ]]; then
  native_windows_transfer=1
  native_transfer_dir="$BACKUP_NATIVE_TRANSFER_ROOT/$timestamp"
  partial="$native_transfer_dir/payload"
fi

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

mkdir -p "$(dirname "$LOCK_FILE")" "$N8N_HEALTH_DIR"
if [[ "$native_windows_transfer" != "1" ]]; then
  mkdir -p "$BACKUP_ROOT"
fi
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

resolve_windows_powershell() {
  local candidate
  if [[ -z "$POWERSHELL_BIN" ]]; then
    for candidate in \
      /mnt/c/Windows/System32/WindowsPowerShell/v1.0/powershell.exe \
      /mnt/c/WINDOWS/System32/WindowsPowerShell/v1.0/powershell.exe; do
      if [[ -x "$candidate" ]]; then POWERSHELL_BIN="$candidate"; break; fi
    done
  fi
  [[ -n "$POWERSHELL_BIN" ]] || {
    echo "Windows PowerShell is required for native storage backup transfer." >&2
    return 1
  }
}

ensure_windows_interop() {
  if [[ -n "${WSL_INTEROP:-}" && -S "$WSL_INTEROP" ]]; then
    return 0
  fi
  # systemd services do not inherit the interactive WSL interop socket. WSL
  # maintains this stable link to init's current socket specifically so native
  # services can launch Windows processes without depending on a shell PID.
  if [[ -S /run/WSL/1_interop ]]; then
    export WSL_INTEROP=/run/WSL/1_interop
    return 0
  fi
  echo 'A live WSL interoperability socket is required for Windows-native backup transfer.' >&2
  return 1
}

invoke_windows_powershell() {
  local powershell_script="$1" encoded_script
  command -v iconv >/dev/null 2>&1 || {
    echo "iconv is required for Windows PowerShell backup transfer." >&2
    return 1
  }
  command -v base64 >/dev/null 2>&1 || {
    echo "base64 is required for Windows PowerShell backup transfer." >&2
    return 1
  }
  # Windows PowerShell expects -EncodedCommand as UTF-16LE. Encoding the whole
  # program also prevents WSL from translating embedded UNC paths in argv and
  # avoids the line-by-line parsing behavior of `-Command -` for try blocks.
  encoded_script="$(printf '%s' "$powershell_script" | iconv -f UTF-8 -t UTF-16LE | base64 -w0)"
  "$POWERSHELL_BIN" -NoProfile -NonInteractive -EncodedCommand "$encoded_script"
}

archive_native_storage() {
  command -v tar >/dev/null 2>&1 || { echo "tar is required for native storage backup transfer." >&2; return 1; }
  tar -C "$N8N_STORAGE_PATH" -cf "$partial/storage.tar" .
  rmdir "$partial/storage"
  storage_archive_sha="$(sha256sum "$partial/storage.tar" | awk '{print $1}')"
  storage_format="tar"
  storage_archive_sha_json="\"$storage_archive_sha\""
}

publish_native_backup() {
  ensure_windows_interop
  resolve_windows_powershell
  id "$WINDOWS_TRANSFER_LINUX_USER" >/dev/null 2>&1 || {
    echo "Windows transfer Linux user is unavailable: $WINDOWS_TRANSFER_LINUX_USER" >&2
    return 1
  }
  if (( EUID == 0 )); then
    chown -R "$WINDOWS_TRANSFER_LINUX_USER:$WINDOWS_TRANSFER_LINUX_USER" "$native_transfer_dir"
  elif [[ -n "$(find "$native_transfer_dir" ! -user "$WINDOWS_TRANSFER_LINUX_USER" -print -quit)" ]]; then
    echo "Native backup staging is not owned by the Windows transfer user." >&2
    return 1
  fi
  find "$native_transfer_dir" -type d -exec chmod 0700 {} +
  find "$native_transfer_dir" -type f -exec chmod 0600 {} +

  local source_windows backup_root_windows powershell_script retention_count_value
  source_windows="$(wslpath -w "$partial")"
  backup_root_windows="$(wslpath -w "$BACKUP_ROOT")"
  source_windows="${source_windows//\'/\'\'}"
  backup_root_windows="${backup_root_windows//\'/\'\'}"
  retention_count_value="${RETENTION_COUNT:-0}"
  powershell_script="\$ErrorActionPreference = 'Stop'
\$ProgressPreference = 'SilentlyContinue'
\$source = '$source_windows'
\$backupRoot = '$backup_root_windows'
\$partial = Join-Path \$backupRoot '.partial-$timestamp'
\$destination = Join-Path \$backupRoot '$timestamp'
New-Item -ItemType Directory -Force -Path \$backupRoot | Out-Null
if (Test-Path -LiteralPath \$destination) { throw 'Backup destination already exists.' }
if (Test-Path -LiteralPath \$partial) { Remove-Item -LiteralPath \$partial -Recurse -Force }
try {
  & robocopy.exe \$source \$partial /E /COPY:DAT /DCOPY:T /R:2 /W:1 /NFL /NDL /NJH /NJS /NP | Out-Null
  if (\$LASTEXITCODE -gt 7) { throw \"robocopy failed with exit code \$LASTEXITCODE\" }
  \$databaseHash = (Get-FileHash -LiteralPath (Join-Path \$partial 'n8n_runtime.dump') -Algorithm SHA256).Hash.ToLowerInvariant()
  if (\$databaseHash -ne '$db_sha') { throw 'Database checksum mismatch after Windows transfer.' }
  \$storageArchive = Join-Path \$partial 'storage.tar'
  & tar.exe -tf \$storageArchive | Out-Null
  if (\$LASTEXITCODE -ne 0) { throw \"tar validation failed with exit code \$LASTEXITCODE\" }
  \$storageHash = (Get-FileHash -LiteralPath \$storageArchive -Algorithm SHA256).Hash.ToLowerInvariant()
  if (\$storageHash -ne '$storage_archive_sha') { throw 'Storage checksum mismatch after Windows transfer.' }
  Move-Item -LiteralPath \$partial -Destination \$destination
  \$backups = @(Get-ChildItem -LiteralPath \$backupRoot -Directory | Where-Object { \$_.Name -match '^\\d{8}T\\d{6}Z$' } | Sort-Object Name -Descending)
  if ($retention_count_value -gt 0) {
    \$backups | Select-Object -Skip $retention_count_value | Remove-Item -Recurse -Force
  } else {
    \$cutoff = (Get-Date).ToUniversalTime().AddDays(-$RETENTION_DAYS)
    \$backups | Where-Object { \$_.LastWriteTimeUtc -lt \$cutoff } | Remove-Item -Recurse -Force
  }
  \$retained = @(Get-ChildItem -LiteralPath \$backupRoot -Directory | Where-Object { \$_.Name -match '^\\d{8}T\\d{6}Z$' } | Sort-Object Name -Descending)
  Write-Output ('backup_destination=' + \$destination)
  Write-Output ('retained_backups=' + ((\$retained | ForEach-Object Name) -join ','))
} catch {
  if (Test-Path -LiteralPath \$partial) { Remove-Item -LiteralPath \$partial -Recurse -Force }
  throw
}"
  # Windows owns traversal, validation, atomic promotion and retention on C:.
  invoke_windows_powershell "$powershell_script"
}

prepare_native_transfer() {
  command -v tar >/dev/null 2>&1 || { echo "tar is required for native backup staging." >&2; return 1; }
  install -d -m 0700 "$partial"
}

validate_native_transfer_prerequisites() {
  local powershell_script
  ensure_windows_interop
  resolve_windows_powershell
  id "$WINDOWS_TRANSFER_LINUX_USER" >/dev/null 2>&1 || {
    echo "Windows transfer Linux user is unavailable: $WINDOWS_TRANSFER_LINUX_USER" >&2
    return 1
  }
  # Prove Windows process startup before stopping Orb. The real transfer runs
  # only after every backup artifact and restore check exist on native ext4.
  powershell_script="\$ErrorActionPreference = 'Stop'; \$ProgressPreference = 'SilentlyContinue'; \$null = Get-Command robocopy.exe; \$null = Get-Command tar.exe"
  invoke_windows_powershell "$powershell_script" >/dev/null
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
  if [[ "$native_windows_transfer" == "1" ]]; then
    archive_native_storage
    return
  fi
  if should_use_robocopy; then
    ensure_windows_interop
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

if [[ "$native_windows_transfer" == "1" ]]; then
  validate_native_transfer_prerequisites
  prepare_native_transfer
fi

if [[ "$MANAGE_N8N_SERVICE" == "1" ]] && systemctl is-active --quiet "$RUNTIME_SERVICE"; then
  n8n_was_active=1
  systemctl stop "$RUNTIME_SERVICE"
fi

mkdir -p "$partial/runtime/env" "$partial/storage"

sudo -n -u postgres pg_dump --format=custom --no-owner --no-acl \
  --dbname=n8n_runtime > "$partial/n8n_runtime.dump"
sudo -n -u postgres pg_restore --list < "$partial/n8n_runtime.dump" > "$partial/n8n_runtime.restore-list.txt"

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
  "storageBytes": $storage_bytes_json,
  "storageFormat": "$storage_format",
  "storageArchiveSha256": $storage_archive_sha_json,
  "restoreVerified": $restore_verified,
  "retentionDays": $RETENTION_DAYS,
  "retentionCount": ${RETENTION_COUNT:-null}
}
EOF

if [[ "$native_windows_transfer" == "1" ]]; then
  publish_native_backup
else
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
fi

echo "Backup completed: $dest"
echo "database_sha256=$db_sha"
echo "executions=$execution_count workflows=$workflow_count storage_bytes=$storage_bytes transport=$BACKUP_STORAGE_COPY_TRANSPORT"
