#!/usr/bin/env bash
set -euo pipefail

# Installs only the dedicated Atendimento tunnel. It never edits or reloads
# cloudflare-runtime.service, crm.service or any other module.

TUNNEL_ID=""
CREDENTIALS_FILE=""
APPLY=0
HOSTNAME="crm-atendimento.skincos.com.br"
CONFIG_ROOT="/etc/skincos"
CONFIG_DIR="$CONFIG_ROOT/cloudflare/atendimento-production"
CONFIG_FILE="$CONFIG_DIR/config.yml"
UNIT_FILE="/etc/systemd/system/cloudflare-atendimento-production.service"
BACKUP_ROOT="/var/backups/skincos/clientes/production-readonly"
LOG_ROOT="/var/log/skincos/cloudflare-atendimento-production"

usage() { echo "Usage: $0 --tunnel-id UUID --credentials-file /etc/skincos/cloudflare/atendimento-production/UUID.json [--apply]"; }
while [[ $# -gt 0 ]]; do
  case "$1" in
    --tunnel-id) [[ $# -ge 2 ]] || { usage >&2; exit 64; }; TUNNEL_ID="$2"; shift 2 ;;
    --credentials-file) [[ $# -ge 2 ]] || { usage >&2; exit 64; }; CREDENTIALS_FILE="$2"; shift 2 ;;
    --apply) APPLY=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown option: $1" >&2; usage >&2; exit 64 ;;
  esac
done
[[ "$TUNNEL_ID" =~ ^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$ ]] || { echo 'A valid dedicated tunnel UUID is required.' >&2; exit 64; }
[[ "$CREDENTIALS_FILE" == "$CONFIG_DIR"/* && "$CREDENTIALS_FILE" != *'..'* && "$CREDENTIALS_FILE" != *' '* ]] || { echo 'Credentials must be under the dedicated native config directory.' >&2; exit 64; }

for command_name in sudo install date mktemp systemctl; do command -v "$command_name" >/dev/null 2>&1 || { echo "Missing required command: $command_name" >&2; exit 1; }; done
sudo -n true
sudo -n test -x /usr/bin/cloudflared || { echo 'cloudflared is unavailable at /usr/bin/cloudflared.' >&2; exit 1; }
if ! sudo -n test -r "$CREDENTIALS_FILE"; then
  echo "Dedicated tunnel credentials are unavailable: $CREDENTIALS_FILE" >&2
  exit 78
fi
mode="$(sudo -n stat -c '%a' "$CREDENTIALS_FILE")"
owner="$(sudo -n stat -c '%U:%G' "$CREDENTIALS_FILE")"
[[ "$mode" == "640" && "$owner" == "root:skincos" ]] || { echo 'Tunnel credentials must be root:skincos mode 0640.' >&2; exit 1; }

if [[ "$APPLY" != "1" ]]; then
  echo "dry_run=true dedicated_tunnel=$TUNNEL_ID hostname=$HOSTNAME service=cloudflare-atendimento-production.service"
  echo "config=$CONFIG_FILE credentials=$CREDENTIALS_FILE target=http://127.0.0.1:8110"
  exit 0
fi

stamp="$(date -u +%Y%m%dT%H%M%SZ)"
sudo -n install -d -m 0750 -o root -g skincos "$CONFIG_DIR" "$LOG_ROOT"
sudo -n install -d -m 0700 -o root -g root "$BACKUP_ROOT"
for path in "$CONFIG_FILE" "$UNIT_FILE"; do
  if sudo -n test -f "$path"; then sudo -n cp -p "$path" "$BACKUP_ROOT/${stamp}-$(basename "$path")"; fi
done

config_tmp="$(mktemp)"
unit_tmp="$(mktemp)"
trap 'rm -f "$config_tmp" "$unit_tmp"' EXIT
printf '%s\n' \
  "tunnel: $TUNNEL_ID" \
  "credentials-file: $CREDENTIALS_FILE" \
  'ingress:' \
  "  - hostname: $HOSTNAME" \
  '    service: http://127.0.0.1:8110' \
  '  - service: http_status:404' >"$config_tmp"
printf '%s\n' \
  '[Unit]' \
  'Description=Skincos dedicated Cloudflare tunnel for isolated Atendimento production' \
  'After=network-online.target crm-atendimento-production.service' \
  'Wants=network-online.target' \
  '' \
  '[Service]' \
  'Type=simple' \
  'User=skincos' \
  'Group=skincos' \
  "Environment=CLOUDFLARE_TUNNEL_ID=$TUNNEL_ID" \
  "Environment=CLOUDFLARED_CONFIG_PATH=$CONFIG_FILE" \
  "ExecStart=/usr/bin/cloudflared tunnel --protocol http2 --config $CONFIG_FILE run $TUNNEL_ID" \
  'Restart=always' 'RestartSec=5' 'TimeoutStopSec=20' 'KillMode=control-group' \
  'NoNewPrivileges=true' 'PrivateTmp=true' 'ProtectSystem=strict' 'ProtectHome=read-only' \
  "ReadWritePaths=$LOG_ROOT" 'UMask=0027' \
  "StandardOutput=append:$LOG_ROOT/tunnel.out.log" \
  "StandardError=append:$LOG_ROOT/tunnel.err.log" \
  '' '[Install]' 'WantedBy=multi-user.target' >"$unit_tmp"
sudo -n /usr/bin/cloudflared tunnel --config "$config_tmp" ingress validate
sudo -n install -m 0640 -o root -g skincos "$config_tmp" "$CONFIG_FILE"
sudo -n install -m 0644 -o root -g root "$unit_tmp" "$UNIT_FILE"
sudo -n systemctl daemon-reload
sudo -n systemctl enable --now cloudflare-atendimento-production.service
sudo -n systemctl is-active --quiet cloudflare-atendimento-production.service
echo "dedicated_tunnel_active=true hostname=$HOSTNAME service=cloudflare-atendimento-production.service backup_root=$BACKUP_ROOT"
