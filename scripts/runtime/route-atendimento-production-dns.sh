#!/usr/bin/env bash
set -euo pipefail

# The DNS route is deliberately a separate, explicit operation.  It never
# changes a service and it accepts only the ID of a pre-created dedicated
# tunnel; the Cloudflare origin certificate path and hostname are fixed.
readonly SCRIPT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd -P)"
readonly CONFIG_DIR='/etc/skincos/cloudflare/atendimento-production'
readonly ORIGIN_CERT="$CONFIG_DIR/cert.pem"
readonly HOSTNAME='crm-atendimento.skincos.com.br'

TUNNEL_ID=''
SOURCE_SHA="${SKINCOS_GLOBAL_COORDINATION_SOURCE_SHA:-}"
COORDINATION_CLOSURE="${SKINCOS_GLOBAL_COORDINATION_CLOSURE_FILE:-}"
APPLY=0
usage() { echo "Usage: $0 --tunnel-id <uuid> --source-sha <full-sha> --coordination-closure <json> [--apply]"; }
while [[ $# -gt 0 ]]; do
  case "$1" in
    --tunnel-id) shift; TUNNEL_ID="${1:-}" ;;
    --source-sha) shift; SOURCE_SHA="${1:-}" ;;
    --coordination-closure) shift; COORDINATION_CLOSURE="${1:-}" ;;
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
[[ "$SOURCE_SHA" =~ ^[0-9a-f]{40}$ ]] || { echo 'SOURCE_SHA must be a full lowercase commit SHA.' >&2; exit 64; }
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

[[ -n "$COORDINATION_CLOSURE" && -f "$COORDINATION_CLOSURE" ]] || {
  echo 'An immutable Atendimento dependency-closure attestation is required for the DNS mutation.' >&2
  exit 78
}
coordination_proof="${SKINCOS_GLOBAL_COORDINATION_PROOF_FILE:-/var/lib/skincos-runtime/global-coordination/cloudflare-atendimento-production-dns-$$.json}"
coordination_acquired=0
coordination_run() {
  "$SCRIPT_ROOT/scripts/runtime/global-coordination-mini-pc.sh" "$@" --proof-file "$coordination_proof"
}
cleanup() {
  if (( coordination_acquired == 1 )); then
    coordination_run release >/dev/null 2>&1 || echo 'Unable to release the mini-PC Cloudflare lease; it will expire fail-closed.' >&2
  fi
}
trap cleanup EXIT INT TERM
coordination_run acquire \
  --resource cloudflare:atendimento:production --module atendimento --source "$SOURCE_SHA" \
  --closure-file "$COORDINATION_CLOSURE" --operation mutation \
  --idempotency-key "mini-pc:cloudflare:atendimento:production:$SOURCE_SHA:$$" >/dev/null
coordination_acquired=1
coordination_run check \
  --resource cloudflare:atendimento:production --module atendimento --source "$SOURCE_SHA" \
  --closure-file "$COORDINATION_CLOSURE" >/dev/null

sudo -n /usr/bin/cloudflared --origincert "$ORIGIN_CERT" tunnel route dns "$TUNNEL_ID" "$HOSTNAME"
printf 'dns_routed=true tunnel_id=%s hostname=%s\n' "$TUNNEL_ID" "$HOSTNAME"
