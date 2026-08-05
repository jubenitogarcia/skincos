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
  production) ENV_FILE="$CONFIG_ROOT/crm.env"; BACKUP_ROOT="${BACKUP_ROOT:-/var/backups/skincos/clientes}" ;;
  staging) ENV_FILE="$CONFIG_ROOT/crm-atendimento-staging-migrator.env"; BACKUP_ROOT="${BACKUP_ROOT:-/var/backups/skincos/clientes/staging}" ;;
  *) echo "Unsupported target: $TARGET" >&2; exit 64 ;;
esac
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

checkpoint=''
if [[ "$ACTION" == 'apply' ]]; then
  stamp="$(date -u +%Y%m%dT%H%M%SZ)"
  checkpoint="$BACKUP_ROOT/harmonia-${TARGET}-${stamp}.json"
  install -d -o root -g skincos -m 0750 "$BACKUP_ROOT"
fi

args=("--target" "$TARGET")
if [[ "$ACTION" == 'apply' ]]; then args+=(--apply --checkpoint "$checkpoint"); else args+=(--dry-run); fi
if [[ -n "${SKINCOS_RELEASE_ID:-}" ]]; then args+=(--release-sha "$SKINCOS_RELEASE_ID"); fi
exec node "$ROOT_DIR/crm/api/scripts/migrate-harmonia-schema.mjs" "${args[@]}"
