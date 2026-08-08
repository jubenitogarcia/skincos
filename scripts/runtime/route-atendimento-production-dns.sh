#!/usr/bin/env bash
set -euo pipefail

# The DNS route is deliberately a separate, explicit operation.  It never
# changes a service and it accepts only the ID of a pre-created dedicated
# tunnel; the Cloudflare origin certificate path and hostname are fixed.
readonly CONFIG_DIR='/etc/skincos/cloudflare/atendimento-production'
readonly ORIGIN_CERT="$CONFIG_DIR/cert.pem"
readonly HOSTNAME='crm-atendimento.skincos.com.br'

TUNNEL_ID=''
APPLY=0
usage() { echo "Usage: $0 --tunnel-id <uuid> [--apply]"; }
while [[ $# -gt 0 ]]; do
  case "$1" in
    --tunnel-id) shift; TUNNEL_ID="${1:-}" ;;
    --apply) APPLY=1 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown option: $1" >&2; usage >&2; exit 64 ;;
  esac
  shift
done
[[ "$TUNNEL_ID" =~ ^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$ ]] || {
  echo 'TUNNEL_ID must be a lowercase RFC 4122 UUID.' >&2
  exit 64
}
for command_name in sudo; do
  command -v "$command_name" >/dev/null 2>&1 || { echo "Missing $command_name" >&2; exit 1; }
done
sudo -n true
sudo -n test -x /usr/bin/cloudflared || { echo 'cloudflared is unavailable at /usr/bin/cloudflared.' >&2; exit 78; }
sudo -n test -f "$ORIGIN_CERT" || { echo 'Fixed Cloudflare origin certificate is unavailable.' >&2; exit 78; }
sudo -n test ! -L "$ORIGIN_CERT" || { echo 'Cloudflare origin certificate must not be a symlink.' >&2; exit 1; }
[[ "$(sudo -n stat -c '%a' "$ORIGIN_CERT")" == '600' ]] || { echo 'Cloudflare origin certificate must be mode 0600.' >&2; exit 1; }
[[ "$(sudo -n stat -c '%U:%G' "$ORIGIN_CERT")" == 'root:root' ]] || { echo 'Cloudflare origin certificate must be root:root.' >&2; exit 1; }

if [[ "$APPLY" != '1' ]]; then
  printf 'dry_run=true tunnel_id=%s hostname=%s dns_change=false\n' "$TUNNEL_ID" "$HOSTNAME"
  exit 0
fi

sudo -n /usr/bin/cloudflared --origincert "$ORIGIN_CERT" tunnel route dns "$TUNNEL_ID" "$HOSTNAME"
printf 'dns_routed=true tunnel_id=%s hostname=%s\n' "$TUNNEL_ID" "$HOSTNAME"
