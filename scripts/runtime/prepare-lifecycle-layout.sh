#!/usr/bin/env bash
set -euo pipefail

# This is a data-copy helper, not a service manager. It intentionally leaves
# the legacy runtime intact. The coordinated cutover script owns stop/start.

RUNTIME_ROOT="${RUNTIME_ROOT:-/mnt/c/CodexRuntime}"
LEGACY_REPO_ROOT="${LEGACY_REPO_ROOT:-/mnt/c/CodexShared/Projetos/skincos}"
APPLY=0
FINAL_SYNC=0
SKIP_ORB_STATE=0
SKIP_MESSAGING_STATE=0

usage() {
  cat <<'EOF'
Usage: scripts/runtime/prepare-lifecycle-layout.sh [--apply] [--final-sync] [--skip-orb-state] [--skip-messaging-state]

Creates the lifecycle layout under C:\CodexRuntime and copies mutable runtime
state from the legacy layout. Without --apply it reports the planned copies.
--final-sync updates existing destination files but never deletes a legacy
source or an existing destination. It is reserved for the short window after
the old services have stopped.
--skip-orb-state is only for an already-completed independent pre-copy. It
cannot be combined with --final-sync.
--skip-messaging-state has the same restriction for the WhatsApp channel.
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --apply) APPLY=1 ;;
    --final-sync) FINAL_SYNC=1 ;;
    --skip-orb-state) SKIP_ORB_STATE=1 ;;
    --skip-messaging-state) SKIP_MESSAGING_STATE=1 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown option: $1" >&2; usage >&2; exit 1 ;;
  esac
  shift
done

if [[ "$FINAL_SYNC" == "1" && "$APPLY" != "1" ]]; then
  echo "--final-sync requires --apply." >&2
  exit 1
fi
if [[ "$FINAL_SYNC" == "1" && ( "$SKIP_ORB_STATE" == "1" || "$SKIP_MESSAGING_STATE" == "1" ) ]]; then
  echo "State skip options cannot be used during the final sync." >&2
  exit 1
fi

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
secrets_dir="$RUNTIME_ROOT/secrets"

declare -a directories=(
  "$RUNTIME_ROOT/state/orb"
  "$RUNTIME_ROOT/state/messaging-whatsapp"
  "$RUNTIME_ROOT/state/crm"
  "$RUNTIME_ROOT/state/booking"
  "$RUNTIME_ROOT/config/cloudflare/orb"
  "$RUNTIME_ROOT/config/cloudflare/runtime"
  "$RUNTIME_ROOT/logs/orb"
  "$RUNTIME_ROOT/logs/messaging-whatsapp"
  "$RUNTIME_ROOT/logs/crm"
  "$RUNTIME_ROOT/logs/booking"
  "$RUNTIME_ROOT/logs/cloudflare-orb"
  "$RUNTIME_ROOT/logs/cloudflare-runtime"
  "$RUNTIME_ROOT/backups/orb"
  "$RUNTIME_ROOT/backups/messaging-whatsapp"
  "$RUNTIME_ROOT/backups/crm"
  "$RUNTIME_ROOT/backups/booking"
  "$RUNTIME_ROOT/artifacts/booking"
  "$RUNTIME_ROOT/cache/orb"
  "$RUNTIME_ROOT/cache/messaging-whatsapp"
  "$RUNTIME_ROOT/cache/crm"
  "$RUNTIME_ROOT/cache/booking"
  "$RUNTIME_ROOT/tmp/orb"
  "$RUNTIME_ROOT/tmp/messaging-whatsapp"
  "$RUNTIME_ROOT/tmp/crm"
  "$RUNTIME_ROOT/tmp/booking"
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
    mkdir -p "$destination"
    local -a args=(-a)
    [[ "$FINAL_SYNC" == "0" ]] && args+=(--ignore-existing)
    rsync "${args[@]}" "$source" "$destination/"
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
    if [[ -r "$source" ]]; then
      install -m 0600 "$source" "$destination"
    else
      sudo -n install -m 0600 "$source" "$destination"
    fi
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
    install -D -m 0640 "$source_config" "$destination_config"
    rewrite_credentials_file "$destination_config" "$destination_secret"
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
  local destination_config="$RUNTIME_ROOT/config/cloudflare/runtime/config.yml"
  local destination_env="$RUNTIME_ROOT/config/cloudflare/runtime/tunnel.env"
  sync_tunnel_config runtime "$source_config" "$destination_config" "$secrets_dir/cloudflare-runtime.json"
  echo "TUNNEL runtime environment -> $destination_env"
  if [[ "$APPLY" == "1" && ( "$FINAL_SYNC" == "1" || ! -e "$destination_env" ) ]]; then
    printf 'CLOUDFLARED_CONFIG_PATH=%s\n' "$destination_config" | install -m 0640 /dev/stdin "$destination_env"
  fi
}

harden_windows_secret_acl() {
  local windows_path
  windows_path="$(wslpath -w "$secrets_dir")"
  # WSL services access C: through the Windows admin identity. Restricting this
  # directory to that identity plus LocalSystem keeps these files out of normal
  # Windows user profiles while preserving the service mount contract.
  /mnt/c/Windows/System32/icacls.exe "$windows_path" /inheritance:r /grant:r 'admin:(OI)(CI)F' 'NT AUTHORITY\SYSTEM:(OI)(CI)F' >/dev/null
}

echo "Runtime root: $RUNTIME_ROOT"
echo "Mode: $([[ "$APPLY" == "1" ]] && ([[ "$FINAL_SYNC" == "1" ]] && echo final-sync || echo pre-copy) || echo dry-run)"
for directory in "${directories[@]}"; do
  echo "DIR $directory"
  [[ "$APPLY" == "1" ]] && mkdir -p "$directory"
done

if [[ "$SKIP_ORB_STATE" == "1" ]]; then
  echo "SKIP orb state: completed by the independently recorded pre-copy."
else
  sync_path "$legacy_orb/n8n-home" "$RUNTIME_ROOT/state/orb"
fi
if [[ "$SKIP_MESSAGING_STATE" == "1" ]]; then
  echo "SKIP messaging state: completed by the independently recorded pre-copy."
else
  sync_path "$legacy_orb/evolution-api/instances" "$RUNTIME_ROOT/state/messaging-whatsapp"
  sync_path "$legacy_orb/evolution-api/store" "$RUNTIME_ROOT/state/messaging-whatsapp"
fi
sync_path "$LEGACY_REPO_ROOT/modules/automations/n8n/workflows" "$RUNTIME_ROOT/state/orb"
sync_path "$legacy_orb/logs/." "$RUNTIME_ROOT/logs/orb"
sync_path "$legacy_crm/var" "$RUNTIME_ROOT/state/crm"
sync_path "$legacy_booking/report" "$RUNTIME_ROOT/artifacts/booking"
sync_path "$legacy_booking/debug" "$RUNTIME_ROOT/artifacts/booking"
sync_path "$legacy_booking/chrome-profile" "$RUNTIME_ROOT/state/booking"
echo "REBUILD $RUNTIME_ROOT/state/booking/venv from the locked booking requirements during cutover"

sync_secret "$legacy_orb/env/n8n.env" "$secrets_dir/orb.env"
sync_secret "$legacy_orb/env/n8n-business.env" "$secrets_dir/orb-business.env"
sync_secret "$legacy_orb/env/evolution-api.env" "$secrets_dir/messaging-whatsapp.env"
sync_secret "$legacy_crm/env/crm-api.env" "$secrets_dir/crm.env"
sync_secret "$legacy_booking/env/booking-api.env" "$secrets_dir/booking.env"
sync_tunnel_config orb "$legacy_orb/cloudflared/orb-config.yml" "$RUNTIME_ROOT/config/cloudflare/orb/config.yml" "$secrets_dir/cloudflare-orb.json"
sync_runtime_tunnel

if [[ "$APPLY" == "1" ]]; then
  harden_windows_secret_acl
  echo "Copy complete. Legacy runtime was preserved; only the coordinated cutover may stop services or retire old paths."
else
  echo "Dry run complete. Use --apply only after the source PR, backup checkpoint and service cutover plan are approved."
fi
