#!/usr/bin/env bash
set -euo pipefail

# Roll back only the isolated Atendimento service to an already staged
# immutable release. No shared service, tunnel or CRM process is restarted.

RELEASE_SHA=""
APPLY=0
RELEASE_BASE="/opt/skincos/releases"
CONFIG_ROOT="/etc/skincos"
CONTROL_FILE="$CONFIG_ROOT/atendimento-production/module-control.json"
BACKUP_ROOT="/var/backups/skincos/clientes/production-readonly"
SERVICE="crm-atendimento-production.service"
SOURCE_ROOT=""
PROTECTED_SERVICES=(
  "crm.service"
  "crm-atendimento-staging.service"
  "crm-jobs.service"
  "cloudflare-runtime.service"
  "cloudflare-orb.service"
  "orb.service"
  "orb-proxy.service"
  "orb-ccg-executor.service"
  "skincos-orb-mcp-readonly.service"
)

snapshot_protected_services() {
  local service main_pid started_at
  for service in "${PROTECTED_SERVICES[@]}"; do
    main_pid="$(sudo -n systemctl show --property=MainPID --value "$service" 2>/dev/null || true)"
    started_at="$(sudo -n systemctl show --property=ActiveEnterTimestampMonotonic --value "$service" 2>/dev/null || true)"
    printf '%s|%s|%s\n' "$service" "$main_pid" "$started_at"
  done
}

usage() { echo "Usage: $0 --to-sha <full-sha> [--apply]"; }
while [[ $# -gt 0 ]]; do
  case "$1" in
    --to-sha) [[ $# -ge 2 ]] || { usage >&2; exit 64; }; RELEASE_SHA="$2"; shift 2 ;;
    --apply) APPLY=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown option: $1" >&2; usage >&2; exit 64 ;;
  esac
done
[[ "$RELEASE_SHA" =~ ^[0-9a-f]{40}$ ]] || { echo '--to-sha must be a full lowercase SHA.' >&2; exit 64; }
SOURCE_ROOT="$RELEASE_BASE/$RELEASE_SHA/source"

for command_name in sudo install date mktemp systemctl curl; do command -v "$command_name" >/dev/null 2>&1 || { echo "Missing required command: $command_name" >&2; exit 1; }; done
sudo -n true
sudo -n test -d "$SOURCE_ROOT" || { echo "Immutable release is unavailable: $SOURCE_ROOT" >&2; exit 78; }
sudo -n test -x "$SOURCE_ROOT/scripts/crm/run-api-linux.sh" || { echo 'Release launcher is unavailable.' >&2; exit 78; }
sudo -n test -f "$SOURCE_ROOT/.skincos-atendimento-release.json" || { echo 'Release evidence marker is unavailable.' >&2; exit 78; }
sudo -n grep -Fq "\"releaseSha\":\"$RELEASE_SHA\"" "$SOURCE_ROOT/.skincos-atendimento-release.json" || { echo 'Release marker SHA mismatch.' >&2; exit 78; }
sudo -n grep -Fq '"target":"production"' "$SOURCE_ROOT/.skincos-atendimento-release.json" || { echo 'Release marker target mismatch.' >&2; exit 78; }
sudo -n grep -Fq '"readOnly":true' "$SOURCE_ROOT/.skincos-atendimento-release.json" || { echo 'Release marker is not read-only.' >&2; exit 78; }

if [[ "$APPLY" != "1" ]]; then
  echo "dry_run=true service=$SERVICE rollback_sha=$RELEASE_SHA source=$SOURCE_ROOT shared_restart=false"
  exit 0
fi

stamp="$(date -u +%Y%m%dT%H%M%SZ)"
sudo -n install -d -m 0700 -o root -g root "$BACKUP_ROOT"
if sudo -n test -f "$CONTROL_FILE"; then sudo -n cp -p "$CONTROL_FILE" "$BACKUP_ROOT/${stamp}-module-control.json"; fi
if sudo -n test -f "/etc/systemd/system/$SERVICE"; then sudo -n cp -p "/etc/systemd/system/$SERVICE" "$BACKUP_ROOT/${stamp}-$SERVICE"; fi

protected_before="$(snapshot_protected_services)"
control_tmp="$(mktemp)"
trap 'rm -f "$control_tmp"' EXIT
printf '%s\n' "{\"schemaVersion\":1,\"module\":\"atendimento\",\"state\":\"maintenance\",\"releaseSha\":\"$RELEASE_SHA\",\"syntheticOnly\":false,\"reason\":\"rollback-in-progress\",\"updatedAt\":\"$stamp\"}" >"$control_tmp"
sudo -n install -m 0640 -o root -g skincos "$control_tmp" "$CONTROL_FILE"

sudo -n "$SOURCE_ROOT/scripts/runtime/install-atendimento-production-service.sh" --source-root "$SOURCE_ROOT" --apply
sudo -n systemctl is-active --quiet "$SERVICE"

printf '%s\n' "{\"schemaVersion\":1,\"module\":\"atendimento\",\"state\":\"active\",\"releaseSha\":\"$RELEASE_SHA\",\"syntheticOnly\":false,\"reason\":\"rollback-complete\",\"updatedAt\":\"$stamp\"}" >"$control_tmp"
sudo -n install -m 0640 -o root -g skincos "$control_tmp" "$CONTROL_FILE"
health_status="$(curl -sS --max-time 10 -o /dev/null -w '%{http_code}' http://127.0.0.1:8110/api/atendimento/health)"
if [[ "$health_status" != "200" ]]; then
  printf '%s\n' "{\"schemaVersion\":1,\"module\":\"atendimento\",\"state\":\"maintenance\",\"releaseSha\":\"$RELEASE_SHA\",\"syntheticOnly\":false,\"reason\":\"rollback-health-failed\",\"updatedAt\":\"$stamp\"}" >"$control_tmp"
  sudo -n install -m 0640 -o root -g skincos "$control_tmp" "$CONTROL_FILE"
  echo "Rollback health failed: status=$health_status; module left in maintenance." >&2
  exit 1
fi
protected_after="$(snapshot_protected_services)"
[[ "$protected_before" == "$protected_after" ]] || { echo 'A shared CRM, worker, tunnel or Orb module changed during isolated rollback.' >&2; exit 1; }
echo "rollback_complete=true service=$SERVICE rollback_sha=$RELEASE_SHA health_status=$health_status shared_restart=false backup_root=$BACKUP_ROOT"
