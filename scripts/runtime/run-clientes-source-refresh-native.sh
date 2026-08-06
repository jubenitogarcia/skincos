#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
TARGET="${CRM_CLIENTES_SOURCE_REFRESH_TARGET:-}"
ACTION="${1:-${CRM_CLIENTES_SOURCE_REFRESH_ACTION:---dry-run}}"
CONFIG_ROOT="${CONFIG_ROOT:-/etc/skincos}"

case "$TARGET" in
  production)
    ENV_FILE="$CONFIG_ROOT/crm.env"
    BACKUP_ROOT="${CRM_CLIENTES_SOURCE_REFRESH_BACKUP_ROOT:-/var/backups/skincos/clientes}"
    EXPECTED_BACKUP_ROOT='/var/backups/skincos/clientes'
    EXPECTED_OS_USER='skincos'
    ;;
  staging)
    ENV_FILE="$CONFIG_ROOT/crm-atendimento-staging.env"
    BACKUP_ROOT="${CRM_CLIENTES_SOURCE_REFRESH_BACKUP_ROOT:-/var/backups/skincos/clientes/staging}"
    EXPECTED_BACKUP_ROOT='/var/backups/skincos/clientes/staging'
    EXPECTED_OS_USER=''
    ;;
  *) echo 'CRM_CLIENTES_SOURCE_REFRESH_TARGET must be production or staging.' >&2; exit 64 ;;
esac

case "$ACTION" in
  --dry-run|--apply) ;;
  *) echo 'Use --dry-run or --apply.' >&2; exit 64 ;;
esac
[[ "$BACKUP_ROOT" == "$EXPECTED_BACKUP_ROOT" ]] || {
  echo "CRM_CLIENTES_SOURCE_REFRESH_BACKUP_ROOT is fixed to $EXPECTED_BACKUP_ROOT for $TARGET." >&2
  exit 64
}
if [[ -n "$EXPECTED_OS_USER" && "$(id -un)" != "$EXPECTED_OS_USER" ]]; then
  echo "The $TARGET source refresh must run as the OS user $EXPECTED_OS_USER." >&2
  exit 77
fi
[[ -r "$ENV_FILE" ]] || { echo "Missing private environment: $ENV_FILE" >&2; exit 1; }

# The target environment owns DATABASE_URL.  The source overlay contributes only
# the read-only Google configuration and may never retarget the destination.
set -a
# shellcheck disable=SC1090
. "$ENV_FILE"
TARGET_DATABASE_URL="${DATABASE_URL:-}"
if [[ -r "$CONFIG_ROOT/atendimento-source.env" ]]; then
  # shellcheck disable=SC1090
  . "$CONFIG_ROOT/atendimento-source.env"
fi
DATABASE_URL="$TARGET_DATABASE_URL"
export DATABASE_URL
set +a
[[ -n "$DATABASE_URL" ]] || { echo 'DATABASE_URL is missing from the target environment.' >&2; exit 1; }

if [[ "$ACTION" == '--apply' ]]; then
  case "${CRM_CLIENTES_SOURCE_REFRESH_APPLY_CONFIRMED:-0}" in
    1|true|yes|on) ;;
    *) echo 'CRM_CLIENTES_SOURCE_REFRESH_APPLY_CONFIRMED=1 is required for --apply.' >&2; exit 77 ;;
  esac
  [[ -d "$BACKUP_ROOT" && -w "$BACKUP_ROOT" ]] || {
    echo "Checkpoint directory must be pre-provisioned and writable: $BACKUP_ROOT" >&2
    exit 77
  }
  stamp="$(date -u +%Y%m%dT%H%M%SZ)"
  checkpoint="$BACKUP_ROOT/clientes-source-refresh-${TARGET}-${stamp}.dump"
  # libpq does not understand the application-only `uselibpqcompat` query
  # parameter used by the Node pg adapter.  Remove only that parameter from the
  # private backup connection string; DATABASE_URL itself remains unchanged
  # for the application runner.
  backup_database_url="$(printf '%s' "$DATABASE_URL" | sed -E 's/([?&])uselibpqcompat=[^&]*&?/\1/g; s/[?&]$//')"
  # The runtime role is intentionally not a database-wide dump role.  This
  # import mutates only the source-backed tables below, so scope the rollback
  # artifact to those tables instead of requesting unrelated CRM/legacy or
  # contact-governance tables that the role must not read.
  backup_table_args=(
    --table=crm_atendimento.units
    --table=crm_atendimento.professionals
    --table=crm_atendimento.professional_aliases
    --table=crm_atendimento.procedures
    --table=crm_atendimento.procedure_price_codes
    --table=crm_atendimento.schedule_days
    --table=crm_atendimento.clients
    --table=crm_atendimento.attendances
    --table=crm_atendimento.audit_events
    --table=crm_atendimento.import_batches
  )
  pg_dump --format=custom --no-owner "${backup_table_args[@]}" --file="$checkpoint" "$backup_database_url"
  chmod 0640 "$checkpoint"
  echo "checkpoint=$checkpoint sha256=$(sha256sum "$checkpoint" | awk '{print $1}')"
fi

exec node "$ROOT_DIR/crm/api/scripts/refresh-atendimento-source.mjs" "$ACTION"
