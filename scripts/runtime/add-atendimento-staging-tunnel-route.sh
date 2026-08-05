#!/usr/bin/env bash
set -euo pipefail

HOSTNAME="${ATENDIMENTO_STAGING_HOSTNAME:-crm-atendimento-staging.skincos.com.br}"
SERVICE="${ATENDIMENTO_STAGING_SERVICE:-http://127.0.0.1:8109}"
CONFIG="${CLOUDFLARED_CONFIG_PATH:-/etc/skincos/cloudflare/runtime/config.yml}"
TUNNEL_ID="${CLOUDFLARE_TUNNEL_ID:-bab29a40-b532-46b7-a540-c3ff7517ef31}"
BACKUP_ROOT="${BACKUP_ROOT:-/var/backups/skincos/clientes}"
APPLY=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --apply) APPLY=1 ;;
    -h|--help) echo "Usage: $0 [--apply]"; exit 0 ;;
    *) echo "Unknown option: $1" >&2; exit 1 ;;
  esac
  shift
done

sudo -n true
sudo -n test -f "$CONFIG" || { echo "Cloudflare tunnel config is unavailable: $CONFIG" >&2; exit 1; }
sudo -n test -f /etc/skincos/cloudflare-runtime.json || { echo "Cloudflare tunnel credentials are unavailable." >&2; exit 1; }
command -v cloudflared >/dev/null 2>&1 || { echo "cloudflared is unavailable." >&2; exit 1; }

route_present=0
if sudo -n grep -Eq "^[[:space:]]*- hostname:[[:space:]]*$HOSTNAME[[:space:]]*$" "$CONFIG"; then
  route_present=1
fi

if [[ "$route_present" == "1" && "$APPLY" != "1" ]]; then
  echo "route_present=true hostname=$HOSTNAME service=$SERVICE"
  exit 0
fi

if [[ "$APPLY" != "1" ]]; then
  echo "route_present=false hostname=$HOSTNAME service=$SERVICE config=$CONFIG"
  echo "dry_run=true"
  exit 0
fi

stamp="$(date -u +%Y%m%dT%H%M%SZ)"
sudo -n install -d -m 0700 -o root -g root "$BACKUP_ROOT"
sudo -n cp -p "$CONFIG" "$BACKUP_ROOT/${stamp}-cloudflare-runtime-config.yml"
tmp="$(mktemp)"
trap 'rm -f "$tmp"' EXIT
if [[ "$route_present" != "1" ]]; then
  sudo -n awk -v host="$HOSTNAME" -v service="$SERVICE" '
    /^(  - service: http_status:404|  - service: http_status:404[[:space:]]*)$/ && !inserted {
      print "  - hostname: " host
      print "    service: " service
      inserted=1
    }
    { print }
    END { if (!inserted) exit 3 }
  ' "$CONFIG" >"$tmp"
  sudo -n install -m 0640 -o root -g skincos "$tmp" "$CONFIG"
fi
sudo -n cloudflared --config "$CONFIG" tunnel ingress validate
# The DNS CNAME is created through the Cloudflare API control plane. The
# native runtime script owns the local ingress and reload only; keeping DNS
# separate avoids requiring a user origin certificate on this host.
echo "dns_route=external-cloudflare-control-plane tunnel=$TUNNEL_ID hostname=$HOSTNAME"
sudo -n systemctl reload cloudflare-runtime.service 2>/dev/null || sudo -n systemctl restart cloudflare-runtime.service
sudo -n systemctl is-active --quiet cloudflare-runtime.service
echo "route_present=true hostname=$HOSTNAME service=$SERVICE backup=$BACKUP_ROOT/${stamp}-cloudflare-runtime-config.yml"
