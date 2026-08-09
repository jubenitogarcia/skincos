#!/usr/bin/env bash
set -euo pipefail

# Roll back exactly one isolated process to a previously registered immutable
# release.  This script never invokes, reloads, stops or restarts crm.service,
# workers, Orb, Pages, or the shared Cloudflare runtime.
readonly RELEASE_BASE='/opt/skincos/releases'
readonly STATE_ROOT='/var/lib/skincos-runtime/crm-atendimento-production'
readonly SERVICE='crm-atendimento-production.service'
readonly PROTECTED_SERVICES=(
  'crm.service'
  'crm-atendimento-staging.service'
  'crm-jobs.service'
  'cloudflare-runtime.service'
  'cloudflare-orb.service'
  'orb.service'
  'orb-proxy.service'
)

TARGET_SHA=''
APPLY=0
usage() { echo "Usage: $0 --to-sha <full-sha> [--apply]"; }
while [[ $# -gt 0 ]]; do
  case "$1" in
    --to-sha) shift; TARGET_SHA="${1:-}" ;;
    --apply) APPLY=1 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown option: $1" >&2; usage >&2; exit 64 ;;
  esac
  shift
done
[[ "$TARGET_SHA" =~ ^[0-9a-f]{40}$ ]] || { echo '--to-sha must be a full lowercase SHA.' >&2; exit 64; }
readonly SOURCE_ROOT="$RELEASE_BASE/$TARGET_SHA/source"
readonly MANIFEST="$STATE_ROOT/release-manifests/$TARGET_SHA.json"
readonly INSTALLER="$SOURCE_ROOT/scripts/runtime/install-atendimento-production-service.sh"
readonly CONTROL_WRITER="$SOURCE_ROOT/scripts/set-atendimento-production-readonly-control.sh"
readonly VALIDATOR="$SOURCE_ROOT/scripts/validate-atendimento-production-readonly.sh"
readonly COORDINATION_CLOSURE="$SOURCE_ROOT/.skincos-global-coordination-atendimento.json"
for command_name in sudo systemctl curl node; do
  command -v "$command_name" >/dev/null 2>&1 || { echo "Missing $command_name" >&2; exit 1; }
done
sudo -n true
sudo -n test -f "$MANIFEST" || { echo 'Registered rollback release is unavailable.' >&2; exit 78; }
sudo -n test -f "$INSTALLER" || { echo 'Immutable rollback installer is unavailable.' >&2; exit 78; }
sudo -n test -f "$CONTROL_WRITER" || { echo 'Immutable rollback control writer is unavailable.' >&2; exit 78; }
sudo -n test -f "$VALIDATOR" || { echo 'Immutable rollback validator is unavailable.' >&2; exit 78; }
sudo -n grep -Fq "\"releaseSha\":\"$TARGET_SHA\"" "$MANIFEST" || { echo 'Rollback manifest SHA mismatch.' >&2; exit 78; }
sudo -n grep -Fq '"readOnly":true' "$MANIFEST" || { echo 'Rollback manifest is not read-only.' >&2; exit 78; }

snapshot_protected_services() {
  local service main_pid started_at
  for service in "${PROTECTED_SERVICES[@]}"; do
    main_pid="$(sudo -n systemctl show --property=MainPID --value "$service" 2>/dev/null || true)"
    started_at="$(sudo -n systemctl show --property=ActiveEnterTimestampMonotonic --value "$service" 2>/dev/null || true)"
    printf '%s|%s|%s\n' "$service" "$main_pid" "$started_at"
  done
}

if [[ "$APPLY" != '1' ]]; then
  printf 'dry_run=true service=%s rollback_sha=%s shared_restart=false\n' "$SERVICE" "$TARGET_SHA"
  exit 0
fi

sudo -n test -f "$COORDINATION_CLOSURE" || { echo 'Immutable Atendimento dependency-closure attestation is unavailable.' >&2; exit 78; }
coordination_proof="${SKINCOS_GLOBAL_COORDINATION_PROOF_FILE:-/var/lib/skincos-runtime/global-coordination/release-atendimento-$TARGET_SHA-$$.json}"
coordination_acquired=0
coordination_run() {
  "$SOURCE_ROOT/scripts/runtime/global-coordination-mini-pc.sh" "$@" --proof-file "$coordination_proof"
}
cleanup() {
  if (( coordination_acquired == 1 )); then
  coordination_run release >/dev/null 2>&1 || echo 'Unable to release the mini-PC Atendimento production surface lease; it will expire fail-closed.' >&2
  fi
}
trap cleanup EXIT INT TERM
coordination_run acquire \
  --resource deploy:atendimento:production --module atendimento --source "$TARGET_SHA" \
  --closure-file "$COORDINATION_CLOSURE" --operation mutation \
  --idempotency-key "mini-pc:deploy:atendimento:production:rollback:$TARGET_SHA:$$" >/dev/null
coordination_acquired=1

protected_before="$(snapshot_protected_services)"
coordination_run check \
  --resource deploy:atendimento:production --module atendimento --source "$TARGET_SHA" \
  --closure-file "$COORDINATION_CLOSURE" >/dev/null
sudo -n "$CONTROL_WRITER" \
  --state maintenance --release-sha "$TARGET_SHA" \
  --coordination-closure "$COORDINATION_CLOSURE" \
  --coordination-proof-file "$coordination_proof" --coordination-reuse \
  --reason rollback-in-progress --apply
coordination_run check \
  --resource deploy:atendimento:production --module atendimento --source "$TARGET_SHA" \
  --closure-file "$COORDINATION_CLOSURE" >/dev/null
if ! sudo -n "$INSTALLER" \
  --source-root "$SOURCE_ROOT" \
  --coordination-proof-file "$coordination_proof" --coordination-reuse \
  --apply; then
  coordination_run check \
    --resource deploy:atendimento:production --module atendimento --source "$TARGET_SHA" \
    --closure-file "$COORDINATION_CLOSURE" >/dev/null
  sudo -n "$CONTROL_WRITER" \
    --state maintenance --release-sha "$TARGET_SHA" \
    --coordination-closure "$COORDINATION_CLOSURE" \
    --coordination-proof-file "$coordination_proof" --coordination-reuse \
    --reason rollback-install-failed --apply || true
  exit 1
fi
coordination_run check \
  --resource deploy:atendimento:production --module atendimento --source "$TARGET_SHA" \
  --closure-file "$COORDINATION_CLOSURE" >/dev/null
sudo -n "$CONTROL_WRITER" \
  --state active --release-sha "$TARGET_SHA" \
  --coordination-closure "$COORDINATION_CLOSURE" \
  --coordination-proof-file "$coordination_proof" --coordination-reuse \
  --reason rollback-active --apply
coordination_run check \
  --resource deploy:atendimento:production --module atendimento --source "$TARGET_SHA" \
  --closure-file "$COORDINATION_CLOSURE" >/dev/null
if ! sudo -n "$VALIDATOR" --expected-release-sha "$TARGET_SHA"; then
  coordination_run check \
    --resource deploy:atendimento:production --module atendimento --source "$TARGET_SHA" \
    --closure-file "$COORDINATION_CLOSURE" >/dev/null
  sudo -n "$CONTROL_WRITER" \
    --state maintenance --release-sha "$TARGET_SHA" \
    --coordination-closure "$COORDINATION_CLOSURE" \
    --coordination-proof-file "$coordination_proof" --coordination-reuse \
    --reason rollback-validation-failed --apply || true
  exit 1
fi
protected_after="$(snapshot_protected_services)"
[[ "$protected_before" == "$protected_after" ]] || { echo 'A protected shared service changed during isolated rollback.' >&2; exit 1; }
printf 'rollback_complete=true service=%s rollback_sha=%s shared_restart=false\n' "$SERVICE" "$TARGET_SHA"
