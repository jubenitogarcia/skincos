#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
TARGET="${HARMONIA_MIGRATION_TARGET:-}"
ACTION="${HARMONIA_MIGRATION_ACTION:-dry-run}"
CONFIG_ROOT="${CONFIG_ROOT:-/etc/skincos}"

if [[ -z "$TARGET" ]]; then
  echo 'HARMONIA_MIGRATION_TARGET must be production or staging.' >&2
  exit 64
fi
case "$TARGET" in
  production)
    ENV_FILE="$CONFIG_ROOT/crm.env"
    BACKUP_ROOT="${BACKUP_ROOT:-/var/backups/skincos/clientes}"
    EXPECTED_BACKUP_ROOT='/var/backups/skincos/clientes'
    EXPECTED_OS_USER='skincos'
    ;;
  staging)
    ENV_FILE="$CONFIG_ROOT/crm-atendimento-staging-migrator.env"
    BACKUP_ROOT="${BACKUP_ROOT:-/var/backups/skincos/clientes/staging}"
    EXPECTED_BACKUP_ROOT='/var/backups/skincos/clientes/staging'
    EXPECTED_OS_USER=''
    ;;
  *) echo "Unsupported target: $TARGET" >&2; exit 64 ;;
esac
[[ "$BACKUP_ROOT" == "$EXPECTED_BACKUP_ROOT" ]] || {
  echo "BACKUP_ROOT is fixed to $EXPECTED_BACKUP_ROOT for $TARGET." >&2
  exit 64
}
if [[ -n "$EXPECTED_OS_USER" && "$(id -un)" != "$EXPECTED_OS_USER" ]]; then
  echo "The $TARGET migration must run as the OS user $EXPECTED_OS_USER for peer authentication." >&2
  exit 77
fi
[[ -f "$ENV_FILE" ]] || { echo "Missing private environment: $ENV_FILE" >&2; exit 1; }
# shellcheck disable=SC1090
set -a
. "$ENV_FILE"
set +a
[[ -n "${DATABASE_URL:-}" ]] || { echo 'DATABASE_URL is missing from the private environment.' >&2; exit 1; }

case "$ACTION" in
  dry-run|apply) ;;
  *) echo 'HARMONIA_MIGRATION_ACTION must be dry-run or apply.' >&2; exit 64 ;;
esac

COORDINATION_SOURCE_SHA="${SKINCOS_RELEASE_ID:-}"
COORDINATION_CLOSURE=''
COORDINATION_RESOURCE=''
coordination_acquired=0

checkpoint=''
if [[ "$ACTION" == 'apply' ]]; then
  [[ "$COORDINATION_SOURCE_SHA" =~ ^[0-9a-f]{40}$ ]] || {
    echo 'SKINCOS_RELEASE_ID must be a full lowercase immutable SHA for apply.' >&2
    exit 78
  }
  [[ "$ROOT_DIR" =~ ^/opt/skincos/releases/([0-9a-f]{40})/source$ ]] || {
    echo 'Harmonia apply must run from an immutable native release, never a checkout.' >&2
    exit 78
  }
  [[ "${BASH_REMATCH[1]}" == "$COORDINATION_SOURCE_SHA" ]] || {
    echo 'SKINCOS_RELEASE_ID does not match the immutable native release path.' >&2
    exit 78
  }
  COORDINATION_CLOSURE="$ROOT_DIR/.skincos-global-coordination-atendimento.json"
  [[ -f "$COORDINATION_CLOSURE" ]] || {
    echo 'Atendimento dependency-closure attestation is unavailable in the immutable release.' >&2
    exit 78
  }
  if [[ "$TARGET" == 'staging' ]]; then
    COORDINATION_RESOURCE='deploy:atendimento:staging'
  else
    COORDINATION_RESOURCE='deploy:atendimento:production'
  fi
  # shellcheck disable=SC1091
  source "$ROOT_DIR/scripts/runtime/global-coordination-native.sh"
  native_coordination_init "$COORDINATION_RESOURCE" atendimento "$COORDINATION_SOURCE_SHA" "$COORDINATION_CLOSURE" mutation
  cleanup_coordination() {
    if [[ "$coordination_acquired" == '1' ]]; then
      native_coordination_cleanup || echo 'Unable to release the Harmonia migration lease; it will expire fail-closed.' >&2
      coordination_acquired=0
    fi
  }
  trap cleanup_coordination EXIT INT TERM
  native_coordination_acquire "mini-pc:${COORDINATION_RESOURCE}:harmonia:$COORDINATION_SOURCE_SHA:$$" >/dev/null
  coordination_acquired=1
  native_coordination_check
  stamp="$(date -u +%Y%m%dT%H%M%SZ)"
  checkpoint="$BACKUP_ROOT/harmonia-${TARGET}-${stamp}.json"
  [[ -d "$BACKUP_ROOT" && -w "$BACKUP_ROOT" ]] || {
    echo "Checkpoint directory must be pre-provisioned and writable: $BACKUP_ROOT" >&2
    exit 77
  }
fi

args=("--target" "$TARGET")
if [[ "$ACTION" == 'apply' ]]; then args+=(--apply --checkpoint "$checkpoint"); else args+=(--dry-run); fi
if [[ -n "${SKINCOS_RELEASE_ID:-}" ]]; then args+=(--release-sha "$SKINCOS_RELEASE_ID"); fi
if node "$ROOT_DIR/crm/api/scripts/migrate-harmonia-schema.mjs" "${args[@]}"; then
  if [[ "$ACTION" == 'apply' ]]; then
    native_coordination_check
  fi
else
  status=$?
  exit "$status"
fi
