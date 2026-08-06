#!/usr/bin/env bash
set -euo pipefail

# Creates only the fixed DNS route for the dedicated Atendimento tunnel. The
# default is a dry-run; apply never overwrites an existing DNS record.
TUNNEL_ID=""
ORIGIN_CERT=""
APPLY=0
HOSTNAME="crm-atendimento.skincos.com.br"
CONFIG_DIR="/etc/skincos/cloudflare/atendimento-production"

usage() { echo "Usage: $0 --tunnel-id UUID --origin-cert /etc/skincos/cloudflare/atendimento-production/cert.pem [--apply]"; }
while [[ $# -gt 0 ]]; do
  case "$1" in
    --tunnel-id) [[ $# -ge 2 ]] || { usage >&2; exit 64; }; TUNNEL_ID="$2"; shift 2 ;;
    --origin-cert) [[ $# -ge 2 ]] || { usage >&2; exit 64; }; ORIGIN_CERT="$2"; shift 2 ;;
    --apply) APPLY=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown option: $1" >&2; usage >&2; exit 64 ;;
  esac
done
[[ "$TUNNEL_ID" =~ ^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$ ]] || { echo 'A valid dedicated tunnel UUID is required.' >&2; exit 64; }
[[ "$ORIGIN_CERT" == "$CONFIG_DIR"/* && "$ORIGIN_CERT" != *'..'* && "$ORIGIN_CERT" != *' '* ]] || { echo 'Origin certificate must be under the dedicated native config directory.' >&2; exit 64; }
for command_name in sudo stat; do command -v "$command_name" >/dev/null 2>&1 || { echo "Missing required command: $command_name" >&2; exit 1; }; done
sudo -n true
sudo -n test -x /usr/bin/cloudflared || { echo 'cloudflared is unavailable at /usr/bin/cloudflared.' >&2; exit 1; }
sudo -n test -r "$ORIGIN_CERT" || { echo "Cloudflare origin certificate is unavailable: $ORIGIN_CERT" >&2; exit 78; }
mode="$(sudo -n stat -c '%a' "$ORIGIN_CERT")"
owner="$(sudo -n stat -c '%U:%G' "$ORIGIN_CERT")"
[[ "$mode" == "600" && "$owner" == "root:root" ]] || { echo 'Origin certificate must be root:root mode 0600.' >&2; exit 1; }

if [[ "$APPLY" != "1" ]]; then
  echo "dry_run=true dns_route=$HOSTNAME tunnel=$TUNNEL_ID overwrite=false"
  exit 0
fi

# No --overwrite-dns: an existing record is a deliberate human checkpoint,
# never silently replaced by the release workflow.
sudo -n /usr/bin/cloudflared --origincert "$ORIGIN_CERT" tunnel route dns "$TUNNEL_ID" "$HOSTNAME"
echo "dedicated_dns_route=true hostname=$HOSTNAME tunnel=$TUNNEL_ID overwrite=false"
