#!/usr/bin/env bash
set -euo pipefail

# Installs only the dedicated Clientes/Atendimento tunnel.  Paths and hostname
# are fixed and neither GitHub Environment values nor an env file are executed.
readonly CONFIG_ROOT='/etc/skincos'
readonly CONFIG_DIR="$CONFIG_ROOT/cloudflare/atendimento-production"
readonly CONFIG_FILE="$CONFIG_DIR/config.yml"
readonly UNIT_DEST='/etc/systemd/system/cloudflare-atendimento-production.service'
readonly LOG_ROOT='/var/log/skincos/cloudflare-atendimento-production'
readonly BACKUP_ROOT='/var/backups/skincos/clientes/production-readonly'
readonly HOSTNAME='crm-atendimento.skincos.com.br'

SOURCE_ROOT=''
TUNNEL_ID=''
APPLY=0

usage() {
  echo "Usage: $0 --source-root /opt/skincos/releases/<full-sha>/source --tunnel-id <uuid> [--apply]"
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --source-root) shift; SOURCE_ROOT="${1:-}" ;;
    --tunnel-id) shift; TUNNEL_ID="${1:-}" ;;
    --apply) APPLY=1 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown option: $1" >&2; usage >&2; exit 64 ;;
  esac
  shift
done

[[ "$SOURCE_ROOT" =~ ^/opt/skincos/releases/([0-9a-f]{40})/source$ ]] || {
  echo 'SOURCE_ROOT must be an immutable native release path with a full lowercase SHA.' >&2
  exit 64
}
[[ "$TUNNEL_ID" =~ ^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$ ]] || {
  echo 'TUNNEL_ID must be a lowercase RFC 4122 UUID.' >&2
  exit 64
}
readonly UNIT_SRC="$SOURCE_ROOT/ops/runtime/units/cloudflare-atendimento-production.service"
readonly CREDENTIALS_FILE="$CONFIG_DIR/$TUNNEL_ID.json"

for command_name in sudo install sed systemd-analyze mktemp date; do
  command -v "$command_name" >/dev/null 2>&1 || { echo "Missing $command_name" >&2; exit 1; }
done
sudo -n true
sudo -n test -x /usr/bin/cloudflared || { echo 'cloudflared is unavailable at /usr/bin/cloudflared.' >&2; exit 78; }
sudo -n test -f "$UNIT_SRC" || { echo 'Dedicated tunnel unit template is unavailable in the immutable release.' >&2; exit 78; }
sudo -n test -f "$CREDENTIALS_FILE" || { echo 'Dedicated tunnel credentials are unavailable at the fixed path.' >&2; exit 78; }
sudo -n test ! -L "$CREDENTIALS_FILE" || { echo 'Dedicated tunnel credentials must not be a symlink.' >&2; exit 1; }
[[ "$(sudo -n stat -c '%a' "$CREDENTIALS_FILE")" == '640' ]] || { echo 'Dedicated tunnel credentials must be mode 0640.' >&2; exit 1; }
[[ "$(sudo -n stat -c '%U:%G' "$CREDENTIALS_FILE")" == 'root:skincos' ]] || { echo 'Dedicated tunnel credentials must be root:skincos.' >&2; exit 1; }
sudo -n -u skincos test -r "$CREDENTIALS_FILE" || { echo 'Dedicated tunnel service account cannot read its credentials.' >&2; exit 1; }

tmp_config="$(mktemp /tmp/atendimento-production-tunnel-config.XXXXXX.yml)"
tmp_unit="$(mktemp /tmp/atendimento-production-tunnel-unit.XXXXXX.service)"
trap 'rm -f "$tmp_config" "$tmp_unit"' EXIT
printf '%s\n' \
  "tunnel: $TUNNEL_ID" \
  "credentials-file: $CREDENTIALS_FILE" \
  'ingress:' \
  "  - hostname: $HOSTNAME" \
  '    service: http://127.0.0.1:8110' \
  '  - service: http_status:404' >"$tmp_config"
sed \
  -e "s|__CONFIG_ROOT__|$CONFIG_ROOT|g" \
  -e "s|__LOG_ROOT__|$LOG_ROOT|g" \
  -e "s|__TUNNEL_ID__|$TUNNEL_ID|g" \
  "$UNIT_SRC" >"$tmp_unit"
chmod 0644 "$tmp_unit"
systemd-analyze verify "$tmp_unit"
# Validate as root because mktemp intentionally creates an owner-private
# transient file. Service-account readability of the actual credential was
# already checked above; no temporary secret needs to be broadened.
sudo -n /usr/bin/cloudflared --config "$tmp_config" tunnel ingress validate >/dev/null

if [[ "$APPLY" != '1' ]]; then
  printf 'dry_run=true tunnel_id=%s hostname=%s service=cloudflare-atendimento-production.service shared_restart=false\n' "$TUNNEL_ID" "$HOSTNAME"
  exit 0
fi

stamp="$(date -u +%Y%m%dT%H%M%SZ)"
sudo -n install -d -m 0750 -o root -g skincos "$CONFIG_DIR" "$LOG_ROOT"
sudo -n install -d -m 0700 -o root -g root "$BACKUP_ROOT"
for target in "$CONFIG_FILE" "$UNIT_DEST"; do
  if sudo -n test -f "$target"; then
    sudo -n cp -p "$target" "$BACKUP_ROOT/${stamp}-$(basename "$target")"
  fi
done
sudo -n install -m 0640 -o root -g skincos "$tmp_config" "$CONFIG_FILE"
sudo -n install -m 0644 -o root -g root "$tmp_unit" "$UNIT_DEST"
sudo -n systemctl daemon-reload
sudo -n systemctl enable --now cloudflare-atendimento-production.service >/dev/null
sudo -n systemctl is-active --quiet cloudflare-atendimento-production.service
printf 'installed=true tunnel_id=%s hostname=%s service=cloudflare-atendimento-production.service shared_restart=false\n' "$TUNNEL_ID" "$HOSTNAME"
