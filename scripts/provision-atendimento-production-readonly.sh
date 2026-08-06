#!/usr/bin/env bash
set -euo pipefail

# Provisions the isolated production Clientes runtime contract. The database
# role is SELECT-only and the API remains loopback-only; no public route or
# commercial write is enabled by this script.

ACTION="${1:-}"
if [[ "$ACTION" != "--dry-run" && "$ACTION" != "--apply" ]]; then
  echo "Usage: $0 --dry-run|--apply" >&2
  exit 64
fi

DB_NAME="skincos_crm_local"
APP_ROLE="skincos_clientes_ro"
CONFIG_DIR="/etc/skincos"
ATENDIMENTO_CONFIG="$CONFIG_DIR/crm-clientes-production-readonly.env"
CONTROL_DIR="$CONFIG_DIR/atendimento-production"
CONTROL_FILE="$CONTROL_DIR/module-control.json"
STATE_ROOT="/var/lib/skincos-runtime/crm-atendimento-production"
LOG_ROOT="/var/log/skincos/crm-atendimento-production"
BACKUP_ROOT="/var/backups/skincos/clientes/production-readonly"
PORT="8110"

require_cmd() { command -v "$1" >/dev/null 2>&1 || { echo "Missing required command: $1" >&2; exit 1; }; }
require_cmd sudo
require_cmd openssl
require_cmd install
require_cmd psql
sudo -n true

if [[ "$ACTION" == "--dry-run" ]]; then
  sudo -n -u postgres psql --dbname=postgres --set=ON_ERROR_STOP=1 --tuples-only --no-align <<SQL
select 'database=' || datname from pg_database where datname = '$DB_NAME';
select 'role=' || rolname || ':login=' || rolcanlogin || ':default_read_only=' || coalesce(array_to_string(rolconfig, ','), '')
  from pg_roles where rolname = '$APP_ROLE';
select 'database_connect=' || case when exists (select 1 from pg_roles where rolname = '$APP_ROLE')
  then has_database_privilege('$APP_ROLE', '$DB_NAME', 'CONNECT')::text else 'missing' end;
SQL
  for path in "$ATENDIMENTO_CONFIG" "$CONTROL_FILE"; do
    if sudo -n test -f "$path"; then echo "present=$path"; else echo "missing=$path"; fi
  done
  echo "service=crm-atendimento-production.service port=$PORT loopback_only=true"
  exit 0
fi

stamp="$(date -u +%Y%m%dT%H%M%SZ)"
sudo -n install -d -m 0750 -o root -g skincos "$CONFIG_DIR" "$CONTROL_DIR"
sudo -n install -d -m 0750 -o skincos -g skincos "$STATE_ROOT" "$STATE_ROOT/var" "$LOG_ROOT"
sudo -n install -d -m 0750 -o root -g skincos "$BACKUP_ROOT"

for path in "$ATENDIMENTO_CONFIG" "$CONTROL_FILE"; do
  if sudo -n test -f "$path"; then
    sudo -n cp -p "$path" "$BACKUP_ROOT/${stamp}-$(basename "$path")"
  fi
done

app_password="$(openssl rand -hex 32)"
actor_key="$(openssl rand -hex 32)"
role_exists="$(sudo -n -u postgres psql --dbname=postgres --tuples-only --no-align --set=ON_ERROR_STOP=1 -c "select 1 from pg_roles where rolname = '$APP_ROLE'" | tr -d '[:space:]')"
if [[ "$role_exists" != "1" ]]; then
  sudo -n -u postgres psql --dbname=postgres --set=ON_ERROR_STOP=1 --set=app_password="$app_password" <<SQL
create role $APP_ROLE login password :'app_password';
SQL
fi

sudo -n -u postgres psql --dbname=postgres --set=ON_ERROR_STOP=1 --set=app_password="$app_password" <<SQL
alter role $APP_ROLE login password :'app_password';
alter role $APP_ROLE set default_transaction_read_only = on;
grant connect on database $DB_NAME to $APP_ROLE;

\connect $DB_NAME
revoke create on schema crm_atendimento, crm_caixa from $APP_ROLE;
grant usage on schema crm_atendimento, crm_caixa to $APP_ROLE;
grant select on all tables in schema crm_atendimento, crm_caixa to $APP_ROLE;
alter default privileges for role skincos in schema crm_atendimento grant select on tables to $APP_ROLE;
alter default privileges for role skincos in schema crm_caixa grant select on tables to $APP_ROLE;
alter default privileges for role postgres in schema crm_atendimento grant select on tables to $APP_ROLE;
alter default privileges for role postgres in schema crm_caixa grant select on tables to $APP_ROLE;
SQL

umask 0077
tmp_env="$(mktemp)"
tmp_control="$(mktemp)"
trap 'rm -f "$tmp_env" "$tmp_control"' EXIT
cat >"$tmp_env" <<EOF
NODE_ENV=production
CRM_DOMAIN=atendimento
CRM_API_HOST=127.0.0.1
CRM_API_PORT=$PORT
DATABASE_URL="postgresql://$APP_ROLE:$app_password@127.0.0.1:5432/$DB_NAME?sslmode=disable&application_name=crm-atendimento-production-readonly"
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
CRM_ATENDIMENTO_READ_ONLY=true
CRM_ATENDIMENTO_CLIENTES_ONLY=true
CRM_ATENDIMENTO_COMMERCIAL_WRITES_ENABLED=false
CRM_ATENDIMENTO_SCHEMA_MANAGED=true
EOF
cat >"$tmp_control" <<EOF
{"schemaVersion":1,"module":"atendimento","state":"maintenance","releaseSha":null,"syntheticOnly":false,"reason":"clientes-production-readonly-pending-release","updatedAt":"$stamp"}
EOF
sudo -n install -m 0640 -o root -g skincos "$tmp_env" "$ATENDIMENTO_CONFIG"
sudo -n install -m 0640 -o root -g skincos "$tmp_control" "$CONTROL_FILE"

echo "Atendimento production read-only contract provisioned: database=$DB_NAME app_role=$APP_ROLE service=crm-atendimento-production port=$PORT control_state=maintenance"
