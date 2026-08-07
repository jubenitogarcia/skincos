#!/usr/bin/env bash
set -euo pipefail

# Creates the dedicated Clientes database contract.  It is intentionally a
# local native operation with a dry-run default; it does not route traffic,
# start a tunnel, enable a module, or write commercial data.
readonly DB_NAME='skincos_clientes_production'
readonly OWNER_ROLE='skincos_clientes_owner'
readonly MIGRATOR_ROLE='skincos_clientes_migrator_login'
readonly APP_ROLE='skincos_clientes_ro'
readonly CONFIG_DIR='/etc/skincos'
readonly ATENDIMENTO_CONFIG='/etc/skincos/crm-clientes-production-readonly.env'
readonly CONTROL_DIR='/etc/skincos/atendimento-production'
readonly CONTROL_FILE='/etc/skincos/atendimento-production/module-control.json'
readonly STATE_ROOT='/var/lib/skincos-runtime/crm-atendimento-production'
readonly LOG_ROOT='/var/log/skincos/crm-atendimento-production'
readonly BACKUP_ROOT='/var/backups/skincos/clientes/production-readonly'
readonly PORT='8110'

ACTION="${1:-}"
case "$ACTION" in
  --dry-run|--apply) ;;
  *) echo "Usage: $0 --dry-run|--apply" >&2; exit 64 ;;
esac

for command_name in sudo openssl install psql pg_dump sha256sum date; do
  command -v "$command_name" >/dev/null 2>&1 || { echo "Missing required command: $command_name" >&2; exit 1; }
done
sudo -n true

database_exists() {
  sudo -n -u postgres psql --dbname=postgres --tuples-only --no-align --set=ON_ERROR_STOP=1 \
    -c "select exists(select 1 from pg_database where datname = '$DB_NAME')" | tr -d '[:space:]'
}

if [[ "$ACTION" == '--dry-run' ]]; then
  exists="$(database_exists)"
  sudo -n -u postgres psql --dbname=postgres --tuples-only --no-align --set=ON_ERROR_STOP=1 <<SQL
select 'database_exists=$exists';
select 'role=' || rolname || ':login=' || rolcanlogin || ':read_only=' || coalesce(array_to_string(rolconfig, ','), '')
  from pg_roles where rolname in ('$OWNER_ROLE','$MIGRATOR_ROLE','$APP_ROLE') order by rolname;
SQL
  for target in "$ATENDIMENTO_CONFIG" "$CONTROL_FILE"; do
    if sudo -n test -f "$target"; then echo "present=$(basename "$target")"; else echo "missing=$(basename "$target")"; fi
  done
  printf 'service=crm-atendimento-production.service database=%s app_role=%s migrator_role=%s port=%s loopback_only=true dry_run=true\n' "$DB_NAME" "$APP_ROLE" "$MIGRATOR_ROLE" "$PORT"
  exit 0
fi

stamp="$(date -u +%Y%m%dT%H%M%SZ)"
# pg_dump runs as the PostgreSQL account.  The directory remains private to
# root and postgres; only the checksum, never its path or contents, is logged.
sudo -n install -d -m 0750 -o root -g postgres "$BACKUP_ROOT"
if [[ "$(database_exists)" == 't' ]]; then
  backup="$BACKUP_ROOT/${stamp}-${DB_NAME}-preapply.dump"
  sudo -n -u postgres pg_dump --format=custom --no-owner --no-privileges --dbname="$DB_NAME" --file="$backup"
  sudo -n chmod 0600 "$backup"
  checksum="$(sudo -n sha256sum "$backup" | awk '{print $1}')"
  printf 'backup_created=true backup_sha256=%s\n' "$checksum"
else
  printf 'backup_created=false checkpoint=new_database\n'
fi

sudo -n install -d -m 0750 -o root -g skincos "$CONFIG_DIR" "$CONTROL_DIR"
sudo -n install -d -m 0750 -o skincos -g skincos "$STATE_ROOT" "$STATE_ROOT/var" "$LOG_ROOT"
for target in "$ATENDIMENTO_CONFIG" "$CONTROL_FILE"; do
  if sudo -n test -f "$target"; then
    sudo -n cp -p "$target" "$BACKUP_ROOT/${stamp}-$(basename "$target")"
  fi
done

app_password="$(openssl rand -hex 32)"
migrator_password="$(openssl rand -hex 32)"
actor_key="$(openssl rand -hex 32)"
readiness_token="$(openssl rand -hex 32)"

sudo -n -u postgres psql --dbname=postgres --set=ON_ERROR_STOP=1 <<SQL
do \$\$
begin
  if not exists (select 1 from pg_roles where rolname = '$OWNER_ROLE') then create role $OWNER_ROLE nologin; end if;
  if not exists (select 1 from pg_roles where rolname = '$MIGRATOR_ROLE') then create role $MIGRATOR_ROLE login; end if;
  if not exists (select 1 from pg_roles where rolname = '$APP_ROLE') then create role $APP_ROLE login; end if;
end \$\$;
-- Both values are hexadecimal output generated locally above. Keeping them
-- in stdin avoids putting a password in psql's process arguments or loading
-- a shell environment file.
alter role $MIGRATOR_ROLE login password '$migrator_password';
alter role $APP_ROLE login password '$app_password';
alter role $APP_ROLE set default_transaction_read_only = on;
grant $OWNER_ROLE to $MIGRATOR_ROLE;
SQL

if [[ "$(database_exists)" != 't' ]]; then
  sudo -n -u postgres psql --dbname=postgres --set=ON_ERROR_STOP=1 -c "create database $DB_NAME owner $OWNER_ROLE"
fi

sudo -n -u postgres psql --dbname="$DB_NAME" --set=ON_ERROR_STOP=1 <<SQL
revoke all on database $DB_NAME from public;
revoke create, temporary on database $DB_NAME from $APP_ROLE;
grant connect on database $DB_NAME to $APP_ROLE, $MIGRATOR_ROLE;
create schema if not exists crm_atendimento authorization $OWNER_ROLE;
revoke all on schema crm_atendimento from public;
revoke create on schema crm_atendimento from $APP_ROLE;
grant usage on schema crm_atendimento to $APP_ROLE;
alter default privileges for role $OWNER_ROLE in schema crm_atendimento grant select on tables to $APP_ROLE;
alter default privileges for role $OWNER_ROLE in schema crm_atendimento grant usage, select on sequences to $APP_ROLE;
alter default privileges for role $MIGRATOR_ROLE in schema crm_atendimento grant select on tables to $APP_ROLE;
alter default privileges for role $MIGRATOR_ROLE in schema crm_atendimento grant usage, select on sequences to $APP_ROLE;
SQL

umask 0077
tmp_env="$(mktemp)"
tmp_control="$(mktemp)"
trap 'rm -f "$tmp_env" "$tmp_control"' EXIT
cat >"$tmp_env" <<EOF
NODE_ENV=production
DATABASE_URL=postgresql://$APP_ROLE:$app_password@127.0.0.1:5432/$DB_NAME?sslmode=require&uselibpqcompat=true&application_name=crm-atendimento-production-readonly
ATENDIMENTO_ACTOR_HMAC_KEY=$actor_key
ATENDIMENTO_READINESS_TOKEN=$readiness_token
HARMONIA_WORKER_ENABLED=false
WA_BOOTSTRAP_SYNC_ENABLED=false
WA_BOOTSTRAP_SYNC_AUTO_ON_CONNECTED=false
CRM_LOCAL_NO_AUTH=false
NO_AUTH=false
EOF
cat >"$tmp_control" <<EOF
{"schemaVersion":1,"module":"atendimento","state":"maintenance","releaseSha":null,"readOnly":true,"commercialContactWritesEnabled":false,"syntheticOnly":true,"reason":"clientes-production-readonly-pending-release","updatedAt":"$stamp"}
EOF
sudo -n install -m 0640 -o root -g skincos "$tmp_env" "$ATENDIMENTO_CONFIG"
sudo -n install -m 0640 -o root -g skincos "$tmp_control" "$CONTROL_FILE"

printf 'provisioned=true database=%s app_role=%s migrator_role=%s service=crm-atendimento-production.service port=%s control_state=maintenance commercial_writes=false\n' "$DB_NAME" "$APP_ROLE" "$MIGRATOR_ROLE" "$PORT"
