#!/usr/bin/env bash
set -euo pipefail

# The isolated staging runtime intentionally has no public route. This native
# verifier proves liveness only over its fixed loopback listener and never
# loads an env file, invokes a shared tunnel, or contacts the shared CRM.
readonly PORT='8111'
readonly SERVICE='crm-atendimento-staging.service'
readonly CONTROL_FILE='/etc/skincos/atendimento-staging/module-control.json'
readonly ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
readonly CONTROL_VALIDATOR="$ROOT_DIR/crm/api/scripts/validate-atendimento-staging-control.mjs"
readonly PROTECTED_SERVICES=(
  'crm.service'
  'crm-atendimento-production.service'
  'crm-jobs.service'
  'cloudflare-runtime.service'
  'cloudflare-orb.service'
  'orb.service'
  'orb-proxy.service'
)

RELEASE_SHA=''
usage() { echo "Usage: $0 --expected-release-sha <full-sha>"; }
while [[ $# -gt 0 ]]; do
  case "$1" in
    --expected-release-sha) shift; RELEASE_SHA="${1:-}" ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown option: $1" >&2; usage >&2; exit 64 ;;
  esac
  shift
done
[[ "$RELEASE_SHA" =~ ^[0-9a-f]{40}$ ]] || { echo '--expected-release-sha must be a full lowercase SHA.' >&2; exit 64; }

for command_name in curl ss systemctl sudo node; do
  command -v "$command_name" >/dev/null 2>&1 || { echo "Missing required command: $command_name" >&2; exit 1; }
done
sudo -n true
sudo -n test -r "$CONTROL_FILE" || { echo 'Strict staging control is unavailable.' >&2; exit 1; }
sudo -n test -f "$CONTROL_VALIDATOR" || { echo 'Strict staging control validator is unavailable.' >&2; exit 78; }
sudo -n systemctl is-active --quiet "$SERVICE" || { echo "Service is not active: $SERVICE" >&2; exit 1; }

snapshot_protected_services() {
  local service main_pid started_at
  for service in "${PROTECTED_SERVICES[@]}"; do
    main_pid="$(sudo -n systemctl show --property=MainPID --value "$service" 2>/dev/null || true)"
    started_at="$(sudo -n systemctl show --property=ActiveEnterTimestampMonotonic --value "$service" 2>/dev/null || true)"
    printf '%s|%s|%s\n' "$service" "$main_pid" "$started_at"
  done
}

protected_before="$(snapshot_protected_services)"
listen_line="$(ss -ltn | awk -v port=":$PORT" '$4 == "127.0.0.1" port || $4 == "[::1]" port { print; exit }')"
[[ -n "$listen_line" ]] || { echo "Runtime is not bound to loopback port $PORT." >&2; exit 1; }

# Health is deliberately liveness-only: it must remain 200 even while the
# database is unavailable or staging is held in maintenance. Do not turn this
# into a public readiness probe or leak a private readiness token.
health_status="$(curl -sS --max-time 10 -o /dev/null -w '%{http_code}' "http://127.0.0.1:$PORT/health")"
[[ "$health_status" == '200' ]] || { echo "Liveness health expected 200, got $health_status." >&2; exit 1; }

sudo -n /usr/bin/node "$CONTROL_VALIDATOR" --release-sha "$RELEASE_SHA" >/dev/null
protected_after="$(snapshot_protected_services)"
[[ "$protected_before" == "$protected_after" ]] || { echo 'A protected shared service changed during isolated staging validation.' >&2; exit 1; }
printf 'validation_passed=true service=%s release_sha=%s loopback_health=true shared_restart=false\n' "$SERVICE" "$RELEASE_SHA"
