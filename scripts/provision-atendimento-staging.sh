#!/usr/bin/env bash
set -euo pipefail

# Creates the isolated synthetic staging database contract. Secret material is
# generated in memory and written only to the private native configuration
# file; no value is printed or committed.

ACTION="${1:-}"
if [[ "$ACTION" != "--dry-run" && "$ACTION" != "--apply" ]]; then
  echo "Usage: $0 --dry-run|--apply" >&2
  exit 1
fi

DB_NAME="skincos_staging"
APP_ROLE="skincos_staging_crm_app"
MIGRATOR_ROLE="skincos_staging_migrator_login"
OWNER_ROLE="skincos_staging_crm_owner"
CONFIG_DIR="/etc/skincos"
ATENDIMENTO_CONFIG="$CONFIG_DIR/crm-atendimento-staging.env"
MIGRATOR_CONFIG="$CONFIG_DIR/crm-atendimento-staging-migrator.env"
CONTROL_DIR="$CONFIG_DIR/atendimento"
CONTROL_FILE="$CONTROL_DIR/module-control.json"
STATE_ROOT="/var/lib/skincos-runtime/crm-atendimento"
LOG_ROOT="/var/log/skincos/crm-atendimento"
BACKUP_ROOT="/var/backups/skincos/clientes"

require_cmd() { command -v "$1" >/dev/null 2>&1 || { echo "Missing required command: $1" >&2; exit 1; }; }
require_cmd sudo
require_cmd openssl
require_cmd install
sudo -n true

if [[ "$ACTION" == "--dry-run" ]]; then
  sudo -n -u postgres psql --dbname=postgres --set=ON_ERROR_STOP=1 --tuples-only --no-align <<SQL
select 'database=' || datname from pg_database where datname = '$DB_NAME';
select 'role=' || rolname || ':login=' || rolcanlogin from pg_roles where rolname in ('$APP_ROLE', '$MIGRATOR_ROLE', '$OWNER_ROLE');
SQL
  for path in "$ATENDIMENTO_CONFIG" "$MIGRATOR_CONFIG" "$CONTROL_FILE"; do
    if sudo -n test -f "$path"; then echo "present=$path"; else echo "missing=$path"; fi
  done
  exit 0
fi

stamp="$(date -u +%Y%m%dT%H%M%SZ)"
sudo -n install -d -m 0750 -o root -g skincos "$CONFIG_DIR" "$CONTROL_DIR"
sudo -n install -d -m 0750 -o skincos -g skincos "$STATE_ROOT" "$STATE_ROOT/var" "$LOG_ROOT"
sudo -n install -d -m 0700 -o root -g root "$BACKUP_ROOT"

for path in "$ATENDIMENTO_CONFIG" "$MIGRATOR_CONFIG" "$CONTROL_FILE"; do
  if sudo -n test -f "$path"; then
    sudo -n cp -p "$path" "$BACKUP_ROOT/${stamp}-$(basename "$path")"
  fi
done

app_password="$(openssl rand -hex 32)"
migrator_password="$(openssl rand -hex 32)"
actor_key="$(openssl rand -hex 32)"

sudo -n -u postgres psql --dbname=postgres --set=ON_ERROR_STOP=1 --set=app_password="$app_password" --set=migrator_password="$migrator_password" <<SQL
alter role $APP_ROLE password :'app_password';
alter role $MIGRATOR_ROLE password :'migrator_password';
alter role $MIGRATOR_ROLE inherit;
grant $OWNER_ROLE to $MIGRATOR_ROLE;
grant connect, create on database $DB_NAME to $OWNER_ROLE;
grant connect, create on database $DB_NAME to $MIGRATOR_ROLE;
grant connect on database $DB_NAME to $APP_ROLE;

\connect $DB_NAME
grant usage, create on schema crm_atendimento to $MIGRATOR_ROLE;
alter table if exists crm_atendimento.schema_migrations owner to $OWNER_ROLE;
grant select, insert, update, delete on all tables in schema crm_atendimento, crm_caixa to $MIGRATOR_ROLE;
grant usage, select, update on all sequences in schema crm_atendimento, crm_caixa to $MIGRATOR_ROLE;
grant usage on schema crm_atendimento, crm_caixa, crm_sessions, harmonia to $APP_ROLE;
grant select, insert, update, delete on all tables in schema crm_atendimento, crm_caixa, crm_sessions, harmonia to $APP_ROLE;
grant usage, select, update on all sequences in schema crm_atendimento, crm_caixa, crm_sessions, harmonia to $APP_ROLE;
grant usage, create on schema harmonia to $MIGRATOR_ROLE;
grant select, insert, update, delete on all tables in schema harmonia to $MIGRATOR_ROLE;
grant usage, select, update on all sequences in schema harmonia to $MIGRATOR_ROLE;
alter default privileges for role $OWNER_ROLE in schema crm_atendimento grant select, insert, update, delete on tables to $APP_ROLE;
alter default privileges for role $OWNER_ROLE in schema crm_atendimento grant usage, select, update on sequences to $APP_ROLE;
alter default privileges for role $OWNER_ROLE in schema harmonia grant select, insert, update, delete on tables to $MIGRATOR_ROLE;
alter default privileges for role $OWNER_ROLE in schema harmonia grant usage, select, update on sequences to $MIGRATOR_ROLE;
SQL

app_url="postgresql://${APP_ROLE}:${app_password}@127.0.0.1:5432/${DB_NAME}?sslmode=require&uselibpqcompat=true&application_name=crm-atendimento-staging"
migrator_url="postgresql://${MIGRATOR_ROLE}:${migrator_password}@127.0.0.1:5432/${DB_NAME}?sslmode=require&uselibpqcompat=true&application_name=atendimento-migration"

umask 0077
tmp_env="$(mktemp)"
tmp_migrator="$(mktemp)"
tmp_control="$(mktemp)"
trap 'rm -f "$tmp_env" "$tmp_migrator" "$tmp_control"' EXIT
cat >"$tmp_env" <<EOF
NODE_ENV=production
CRM_DOMAIN=atendimento
CRM_API_HOST=127.0.0.1
CRM_API_PORT=8109
DATABASE_URL="$app_url"
ATENDIMENTO_ACTOR_HMAC_KEY=$actor_key
CRM_RUNTIME_HOME=$STATE_ROOT
VAR_DIR=$STATE_ROOT/var
CRM_MODULE_CONTROL_FILE=$CONTROL_FILE
SKINCOS_CRM_API_ENV_FILE=$ATENDIMENTO_CONFIG
HARMONIA_WORKER_ENABLED=false
WA_BOOTSTRAP_SYNC_ENABLED=false
WA_BOOTSTRAP_SYNC_AUTO_ON_CONNECTED=false
CRM_LOCAL_NO_AUTH=false
NO_AUTH=false
CRM_ATENDIMENTO_COMMERCIAL_WRITES_ENABLED=false
CRM_ATENDIMENTO_SCHEMA_MANAGED=true
EOF
cat >"$tmp_migrator" <<EOF
NODE_ENV=production
DATABASE_URL="$migrator_url"
EOF
cat >"$tmp_control" <<EOF
{"schemaVersion":1,"module":"atendimento","state":"active","releaseSha":"__RELEASE_SHA__","syntheticOnly":true,"reason":"clientes-staging-synthetic","updatedAt":"$stamp"}
EOF
sudo -n install -m 0640 -o root -g skincos "$tmp_env" "$ATENDIMENTO_CONFIG"
sudo -n install -m 0600 -o root -g root "$tmp_migrator" "$MIGRATOR_CONFIG"
sudo -n install -m 0640 -o root -g skincos "$tmp_control" "$CONTROL_FILE"

echo "Atendimento staging database contract provisioned: database=$DB_NAME app_role=$APP_ROLE migrator_role=$MIGRATOR_ROLE control_file=$CONTROL_FILE"
