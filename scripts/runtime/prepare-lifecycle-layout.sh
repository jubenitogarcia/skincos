#!/usr/bin/env bash
set -euo pipefail

# This is a data-copy helper, not a service manager. It intentionally leaves
# the legacy runtime intact. The coordinated cutover script owns stop/start.

RUNTIME_ROOT="${RUNTIME_ROOT:-/mnt/c/CodexRuntime}"
STATE_ROOT="${STATE_ROOT:-/var/lib/skincos-runtime}"
CONFIG_ROOT="${CONFIG_ROOT:-/etc/skincos}"
LOG_ROOT="${LOG_ROOT:-/var/log/skincos}"
TMP_ROOT="${TMP_ROOT:-/var/tmp/skincos}"
ARTIFACT_ROOT="${ARTIFACT_ROOT:-$RUNTIME_ROOT/artifacts}"
LEGACY_REPO_ROOT="${LEGACY_REPO_ROOT:-/mnt/c/CodexShared/Projetos/skincos}"
APPLY=0
FINAL_SYNC=0
SKIP_MESSAGING_STATE=0
SKIP_RUNTIME_DATA=0
SKIP_LEGACY_TRANSFER=0
SYNC_TRANSPORT="${LIFECYCLE_SYNC_TRANSPORT:-auto}"

usage() {
  cat <<'EOF'
Usage: scripts/runtime/prepare-lifecycle-layout.sh [--apply] [--final-sync] [--skip-messaging-state] [--skip-runtime-data] [--skip-legacy-transfer]

Copies mutable runtime state from the Windows legacy layout to native Linux
state/config/log/tmp roots. C:\CodexRuntime remains the durable location for
backups and artifacts. Without --apply it reports the planned copies.
--final-sync updates existing destination files but never deletes a legacy
source or an existing destination. It is reserved for the short window after
the old services have stopped.
--skip-messaging-state has the same restriction for the WhatsApp channel.
--skip-runtime-data skips every recursive legacy directory copy after a
Windows-to-Linux transfer has staged those paths natively.
--skip-legacy-transfer skips every legacy runtime read. It is only valid when
apply-lifecycle-state-transfer.sh has staged both data and private config from
Windows through \\wsl$; it prevents a cutover from falling back to DrvFS.

LIFECYCLE_SYNC_TRANSPORT chooses the directory-copy transport: auto (default)
uses Windows robocopy for paths on /mnt/c and rsync otherwise; robocopy and
rsync force a specific transport.
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --apply) APPLY=1 ;;
    --final-sync) FINAL_SYNC=1 ;;
    --skip-orb-state)
      echo "--skip-orb-state was retired. Stage Orb state with stage-orb-state-archive.sh." >&2
      exit 1
      ;;
    --skip-messaging-state) SKIP_MESSAGING_STATE=1 ;;
    --skip-runtime-data) SKIP_RUNTIME_DATA=1 ;;
    --skip-legacy-transfer) SKIP_LEGACY_TRANSFER=1 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown option: $1" >&2; usage >&2; exit 1 ;;
  esac
  shift
done

if [[ "$FINAL_SYNC" == "1" && "$APPLY" != "1" ]]; then
  echo "--final-sync requires --apply." >&2
  exit 1
fi
if [[ "$FINAL_SYNC" == "1" && "$SKIP_MESSAGING_STATE" == "1" ]]; then
  echo "State skip options cannot be used during the final sync." >&2
  exit 1
fi
case "$SYNC_TRANSPORT" in
  auto|robocopy|rsync) ;;
  *) echo "LIFECYCLE_SYNC_TRANSPORT must be auto, robocopy or rsync." >&2; exit 1 ;;
esac

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || { echo "Missing required command: $1" >&2; exit 1; }
}

require_cmd rsync
if [[ "$APPLY" == "1" ]]; then
  require_cmd install
  require_cmd awk
  require_cmd sed
  require_cmd wslpath
  require_cmd sudo
  sudo -n true
fi

legacy_orb="$RUNTIME_ROOT/n8n"
legacy_crm="$RUNTIME_ROOT/crm-api"
legacy_booking="$RUNTIME_ROOT/booking-api"
legacy_runtime_tunnel="$RUNTIME_ROOT/cloudflared/cs"
secrets_dir="$CONFIG_ROOT"

declare -a directories=(
  "$STATE_ROOT/orb"
  "$STATE_ROOT/messaging-whatsapp"
  "$STATE_ROOT/crm"
  "$STATE_ROOT/booking"
  "$CONFIG_ROOT/cloudflare/orb"
  "$CONFIG_ROOT/cloudflare/runtime"
  "$LOG_ROOT/orb"
  "$LOG_ROOT/messaging-whatsapp"
  "$LOG_ROOT/crm"
  "$LOG_ROOT/booking"
  "$LOG_ROOT/cloudflare-orb"
  "$LOG_ROOT/cloudflare-runtime"
  "$RUNTIME_ROOT/backups/orb"
  "$RUNTIME_ROOT/backups/messaging-whatsapp"
  "$RUNTIME_ROOT/backups/crm"
  "$RUNTIME_ROOT/backups/booking"
  "$ARTIFACT_ROOT/booking"
  "$STATE_ROOT/cache/orb"
  "$STATE_ROOT/cache/messaging-whatsapp"
  "$STATE_ROOT/cache/crm"
  "$STATE_ROOT/cache/booking"
  "$TMP_ROOT/orb"
  "$TMP_ROOT/messaging-whatsapp"
  "$TMP_ROOT/crm"
  "$TMP_ROOT/booking"
  "$secrets_dir"
)

sync_path() {
  local source="$1"
  local destination="$2"
  if [[ ! -e "$source" ]]; then
    echo "SKIP missing: $source"
    return
  fi
  echo "COPY $source -> $destination"
  if [[ "$APPLY" == "1" ]]; then
    if should_use_robocopy "$source" "$destination"; then
      sync_path_robocopy "$source" "$destination"
    else
      local -a args=(-a)
      [[ "$FINAL_SYNC" == "0" ]] && args+=(--ignore-existing)
      if [[ "$destination" == /mnt/c/* ]]; then
        mkdir -p "$destination"
        rsync "${args[@]}" "$source" "$destination/"
      else
        local error_log status
        error_log="$(mktemp)"
        if sudo -n rsync "${args[@]}" "$source" "$destination/" 2>"$error_log"; then
          :
        else
          status=$?
          # A pre-copy intentionally never replaces destination entries. rsync
          # reports code 23 when a legacy node_modules symlink already exists;
          # accept only that exact non-destructive collision, never an I/O or
          # transfer failure. The final sync remains strict and overwrites the
          # current native release only after legacy services have stopped.
          if [[ "$FINAL_SYNC" == "0" && "$status" == "23" ]] \
            && ! grep -vE '^(rsync: .*failed: File exists \(17\)|rsync error: some files/attrs were not transferred.*code 23)' "$error_log" | grep -q .; then
            echo "WARN existing destination entries skipped during pre-copy: $source"
          else
            cat "$error_log" >&2
            rm -f "$error_log"
            return "$status"
          fi
        fi
        rm -f "$error_log"
        sudo -n chown -R skincos:skincos "$destination"
      fi
    fi
  fi
}

resolve_workflows_dir() {
  local root="$1"
  local candidate
  # Domain-first layout is authoritative. The second candidate exists only so
  # a retained pre-cutover rollback worktree remains usable during the window.
  for candidate in "$root/orb/engine/workflows" "$root/modules/automations/n8n/workflows"; do
    [[ -d "$candidate" ]] && { printf '%s\n' "$candidate"; return 0; }
  done
  return 1
}

should_use_robocopy() {
  local source="$1"
  local destination="$2"
  if [[ "$SYNC_TRANSPORT" == "rsync" ]]; then
    return 1
  fi
  if [[ "$SYNC_TRANSPORT" == "robocopy" ]]; then
    command -v robocopy.exe >/dev/null 2>&1 || { echo "robocopy.exe is required by LIFECYCLE_SYNC_TRANSPORT=robocopy." >&2; exit 1; }
    return 0
  fi
  command -v robocopy.exe >/dev/null 2>&1 && [[ "$source" == /mnt/c/* && "$destination" == /mnt/c/* ]]
}

sync_path_robocopy() {
  local source="$1"
  local destination="$2"
  local normalized_source="${source%/.}"
  local target="$destination"
  if [[ "$source" != */. ]]; then
    target="$destination/$(basename "$normalized_source")"
  fi
  mkdir -p "$target"

  local source_windows target_windows status=0
  source_windows="$(wslpath -w "$normalized_source")"
  target_windows="$(wslpath -w "$target")"
  local -a args=(/E /COPY:DAT /DCOPY:T /R:2 /W:1 /NFL /NDL /NJH /NJS /NP)
  if [[ "$FINAL_SYNC" == "0" ]]; then
    args+=(/XC /XN /XO)
  fi
  robocopy.exe "$source_windows" "$target_windows" "${args[@]}" >/dev/null || status=$?
  if (( status > 7 )); then
    echo "robocopy failed with exit code $status for $source -> $target." >&2
    return "$status"
  fi
}

sync_secret() {
  local source="$1"
  local destination="$2"
  if [[ ! -r "$source" ]] && ! sudo -n test -r "$source" 2>/dev/null; then
    echo "SKIP missing secret: $source"
    return
  fi
  echo "SECRET $source -> $destination"
  if [[ "$APPLY" == "1" && ( "$FINAL_SYNC" == "1" || ! -e "$destination" ) ]]; then
    sudo -n install -D -o root -g skincos -m 0640 "$source" "$destination"
  fi
}

yaml_credentials_file() {
  awk '$1 == "credentials-file:" { print $2; exit }' "$1"
}

rewrite_credentials_file() {
  local config="$1"
  local credential="$2"
  local escaped
  escaped="$(printf '%s' "$credential" | sed 's/[&|]/\\&/g')"
  sed -i -E "s|^([[:space:]]*credentials-file:[[:space:]]*).*|\\1$escaped|" "$config"
}

sync_tunnel_config() {
  local label="$1"
  local source_config="$2"
  local destination_config="$3"
  local destination_secret="$4"
  if [[ ! -f "$source_config" ]]; then
    echo "SKIP missing tunnel config: $source_config"
    return
  fi
  echo "TUNNEL $label config -> $destination_config"
  local credential
  credential="$(yaml_credentials_file "$source_config")"
  if [[ -z "$credential" ]] || { [[ ! -r "$credential" ]] && ! sudo -n test -r "$credential" 2>/dev/null; }; then
    echo "Tunnel $label has no readable credentials-file." >&2
    exit 1
  fi
  echo "TUNNEL $label credential -> $destination_secret"
  if [[ "$APPLY" == "1" && ( "$FINAL_SYNC" == "1" || ! -e "$destination_config" ) ]]; then
    sudo -n install -D -o root -g skincos -m 0640 "$source_config" "$destination_config"
    sudo -n sed -i -E "s|^([[:space:]]*credentials-file:[[:space:]]*).*|\\1$(printf '%s' "$destination_secret" | sed 's/[&|]/\\&/g')|" "$destination_config"
  fi
  sync_secret "$credential" "$destination_secret"
}

sync_runtime_tunnel() {
  local source_env="$legacy_runtime_tunnel/cloudflared-cs.env"
  local source_config
  source_config="$(awk -F= '$1 == "CLOUDFLARED_CONFIG_PATH" { print $2; exit }' "$source_env" 2>/dev/null | tr -d '\r' || true)"
  if [[ -z "$source_config" ]]; then
    echo "SKIP missing runtime tunnel environment: $source_env"
    return
  fi
  local destination_config="$CONFIG_ROOT/cloudflare/runtime/config.yml"
  local destination_env="$CONFIG_ROOT/cloudflare/runtime/tunnel.env"
  sync_tunnel_config runtime "$source_config" "$destination_config" "$secrets_dir/cloudflare-runtime.json"
  echo "TUNNEL runtime environment -> $destination_env"
  if [[ "$APPLY" == "1" && ( "$FINAL_SYNC" == "1" || ! -e "$destination_env" ) ]]; then
    printf 'CLOUDFLARED_CONFIG_PATH=%s\n' "$destination_config" | sudo -n install -D -o root -g skincos -m 0640 /dev/stdin "$destination_env"
  fi
}

echo "Runtime root: $RUNTIME_ROOT"
echo "Mode: $([[ "$APPLY" == "1" ]] && ([[ "$FINAL_SYNC" == "1" ]] && echo final-sync || echo pre-copy) || echo dry-run)"
for directory in "${directories[@]}"; do
  echo "DIR $directory"
  if [[ "$APPLY" == "1" ]]; then
    if [[ "$directory" == /mnt/c/* ]]; then
      mkdir -p "$directory"
    else
      sudo -n install -d -o skincos -g skincos -m 0750 "$directory"
    fi
  fi
done

# DrvFS metadata traversal across n8n-home has repeatedly left rsync in D
# state on this host. Orb state is therefore always staged through the
# checksum-verified archive helper into the native filesystem. The final
# cutover promotes that prepared directory atomically after legacy services
# stop; this generic layout helper must never recurse through n8n-home.
echo "ORB state is archive-staged separately; n8n-home is intentionally not synced here."
if [[ "$SKIP_LEGACY_TRANSFER" == "1" ]]; then
  echo "SKIP legacy data and private configuration: Windows-native transfer is authoritative."
elif [[ "$SKIP_RUNTIME_DATA" == "1" ]]; then
  echo "SKIP legacy runtime directories: transferred through the Windows-native channel."
elif [[ "$SKIP_MESSAGING_STATE" == "1" ]]; then
  echo "SKIP messaging state: completed by the independently recorded pre-copy."
else
  sync_path "$legacy_orb/evolution-api/instances" "$STATE_ROOT/messaging-whatsapp"
  sync_path "$legacy_orb/evolution-api/store" "$STATE_ROOT/messaging-whatsapp"
  workflows_source="$(resolve_workflows_dir "$LEGACY_REPO_ROOT" || true)"
  if [[ -n "$workflows_source" ]]; then
    sync_path "$workflows_source" "$STATE_ROOT/orb"
  else
    echo "SKIP missing Orb workflows under $LEGACY_REPO_ROOT"
  fi
  sync_path "$legacy_orb/logs/." "$LOG_ROOT/orb"
  sync_path "$legacy_crm/var" "$STATE_ROOT/crm"
  sync_path "$legacy_booking/report" "$ARTIFACT_ROOT/booking"
  sync_path "$legacy_booking/debug" "$ARTIFACT_ROOT/booking"
  sync_path "$legacy_booking/chrome-profile" "$STATE_ROOT/booking"
  echo "REBUILD $STATE_ROOT/booking/venv from the locked booking requirements during cutover"
fi

if [[ "$SKIP_LEGACY_TRANSFER" != "1" ]]; then
  sync_secret "$legacy_orb/env/n8n.env" "$secrets_dir/orb.env"
  sync_secret "$legacy_orb/env/n8n-business.env" "$secrets_dir/orb-business.env"
  sync_secret "$legacy_orb/env/evolution-api.env" "$secrets_dir/messaging-whatsapp.env"
  sync_secret "$legacy_crm/env/crm-api.env" "$secrets_dir/crm.env"
  sync_secret "$legacy_booking/env/booking-api.env" "$secrets_dir/booking.env"
  sync_tunnel_config orb "$legacy_orb/cloudflared/orb-config.yml" "$CONFIG_ROOT/cloudflare/orb/config.yml" "$secrets_dir/cloudflare-orb.json"
  sync_runtime_tunnel
fi

if [[ "$APPLY" == "1" ]]; then
  # The runtime processes run as skincos:skincos. Keep the configuration root
  # root-owned, but preserve group read/traverse access for environment files
  # and Cloudflare credentials. Removing all group permissions would make the
  # final tunnel units fail only after the legacy services are stopped.
  sudo -n chown -R root:skincos "$CONFIG_ROOT"
  sudo -n find "$CONFIG_ROOT" -type d -exec chmod 0750 {} +
  sudo -n find "$CONFIG_ROOT" -type f -exec chmod 0640 {} +
  echo "Copy complete. Legacy runtime was preserved; only the coordinated cutover may stop services or retire old paths."
else
  echo "Dry run complete. Use --apply only after the source PR, backup checkpoint and service cutover plan are approved."
fi
