#!/usr/bin/env bash
set -euo pipefail

# Provision the isolated production Clientes/Atendimento database and native
# runtime contract. The default is an inspection-only dry run. Apply never
# overwrites an existing database: a verified backup and a human checkpoint are
# required before an already provisioned database can be reused.

ACTION="${1:-}"
if [[ "$ACTION" != "--dry-run" && "$ACTION" != "--apply" ]]; then
  echo "Usage: $0 --dry-run|--apply" >&2
  exit 64
fi

valid_identifier() { [[ "$1" =~ ^[a-z_][a-z0-9_]*$ ]]; }
SOURCE_DB="${CLIENTES_SOURCE_DB:-skincos_crm_local}"
DB_NAME="skincos_clientes_production"
APP_ROLE="skincos_clientes_ro"
MIGRATOR_ROLE="skincos_clientes_migrator"
OWNER_ROLE="skincos_clientes_owner"
valid_identifier "$SOURCE_DB" || { echo 'CLIENTES_SOURCE_DB must be a lowercase PostgreSQL identifier.' >&2; exit 64; }
valid_identifier "$DB_NAME" || { echo 'Dedicated Clientes database identifier is invalid.' >&2; exit 64; }

CONFIG_DIR="/etc/skincos"
ATENDIMENTO_CONFIG="$CONFIG_DIR/crm-clientes-production-readonly.env"
MIGRATOR_CONFIG="$CONFIG_DIR/crm-clientes-production-migrator.env"
CONTROL_DIR="$CONFIG_DIR/atendimento-production"
CONTROL_FILE="$CONTROL_DIR/module-control.json"
STATE_ROOT="/var/lib/skincos-runtime/crm-atendimento-production"
LOG_ROOT="/var/log/skincos/crm-atendimento-production"
BACKUP_ROOT="/var/backups/skincos/clientes/production-readonly"
PORT="8110"

require_cmd() { command -v "$1" >/dev/null 2>&1 || { echo "Missing required command: $1" >&2; exit 1; }; }
for command_name in sudo openssl install psql pg_dump pg_restore createdb date mktemp; do require_cmd "$command_name"; done
sudo -n true

if [[ "$ACTION" == "--dry-run" ]]; then
  sudo -n -u postgres psql --dbname=postgres --set=ON_ERROR_STOP=1 --tuples-only --no-align \
    --set=source_db="$SOURCE_DB" --set=database_name="$DB_NAME" <<'SQL'
select 'source_database=' || coalesce((select datname from pg_database where datname = :'source_db'), 'missing');
select 'target_database=' || coalesce((select datname from pg_database where datname = :'database_name'), 'missing');
select 'roles=' || coalesce((select string_agg(rolname || ':login=' || rolcanlogin, ', ' order by rolname)
  from pg_roles where rolname in ('skincos_clientes_ro', 'skincos_clientes_migrator', 'skincos_clientes_owner')), 'missing');
select 'app_connect=' || case when exists (select 1 from pg_roles where rolname = 'skincos_clientes_ro')
  and exists (select 1 from pg_database where datname = :'database_name')
  then has_database_privilege('skincos_clientes_ro', :'database_name', 'CONNECT')::text else 'missing' end;
SQL
  for path in "$ATENDIMENTO_CONFIG" "$MIGRATOR_CONFIG" "$CONTROL_FILE"; do
    if sudo -n test -f "$path"; then echo "present=$path"; else echo "missing=$path"; fi
  done
  echo "service=crm-atendimento-production.service port=$PORT loopback_only=true schema_managed=true"
  exit 0
fi

stamp="$(date -u +%Y%m%dT%H%M%SZ)"
sudo -n install -d -m 0750 -o root -g skincos "$CONFIG_DIR" "$CONTROL_DIR"
sudo -n install -d -m 0750 -o skincos -g skincos "$STATE_ROOT" "$STATE_ROOT/var" "$LOG_ROOT"
sudo -n install -d -m 0700 -o root -g root "$BACKUP_ROOT"

# Refuse an existing target before changing roles, config or control. This
# makes an accidental rerun safe and forces an explicit verified checkpoint.
target_exists="$(sudo -n -u postgres psql --dbname=postgres --tuples-only --no-align --set=ON_ERROR_STOP=1 \
  --set=database_name="$DB_NAME" -c "select 1 from pg_database where datname = :'database_name'" | tr -d '[:space:]')"
if [[ "$target_exists" == "1" ]]; then
  echo "Target database already exists; use a separately reviewed migration/checkpoint path: $DB_NAME" >&2
  exit 73
fi

# Preserve both control/config and a source snapshot before any target role,
# database, schema or grant is applied. The dump contains no credentials.
for path in "$ATENDIMENTO_CONFIG" "$MIGRATOR_CONFIG" "$CONTROL_FILE"; do
  if sudo -n test -f "$path"; then sudo -n cp -p "$path" "$BACKUP_ROOT/${stamp}-$(basename "$path")"; fi
done
source_dump="$BACKUP_ROOT/${stamp}-${SOURCE_DB}-schemas.dump"
sudo -n -u postgres pg_dump --format=custom --no-owner --no-acl --file="$source_dump" \
  --dbname="$SOURCE_DB" --schema=crm_atendimento --schema=crm_caixa --schema=harmonia
sudo -n chmod 0600 "$source_dump"

app_password="$(openssl rand -hex 32)"
migrator_password="$(openssl rand -hex 32)"
actor_key="$(openssl rand -hex 32)"
readiness_token="$(openssl rand -hex 32)"

sudo -n -u postgres psql --dbname=postgres --set=ON_ERROR_STOP=1 \
  --set=app_password="$app_password" --set=migrator_password="$migrator_password" <<SQL
create role $OWNER_ROLE nologin;
alter role $OWNER_ROLE set default_transaction_read_only = off;
create role $MIGRATOR_ROLE login password :'migrator_password';
alter role $MIGRATOR_ROLE inherit;
grant $OWNER_ROLE to $MIGRATOR_ROLE;
create role $APP_ROLE login password :'app_password';
alter role $APP_ROLE set default_transaction_read_only = on;
create database $DB_NAME owner $OWNER_ROLE;
SQL

# Restore the pre-change snapshot under the dedicated owner. No live source
# database is modified, and no object is restored with a shared owner/ACL.
sudo -n -u postgres pg_restore --exit-on-error --no-owner --no-acl --role="$OWNER_ROLE" \
  --dbname="$DB_NAME" "$source_dump"

# Keep the first production promotion fail-closed even if the source snapshot
# was taken after a staging experiment. This is the only policy normalization
# performed during provisioning; the application role cannot execute it.
sudo -n -u postgres psql --dbname=postgres --set=ON_ERROR_STOP=1 <<SQL
grant connect on database $DB_NAME to $APP_ROLE;
grant connect, create on database $DB_NAME to $MIGRATOR_ROLE;
revoke create, temporary on database $DB_NAME from public;
revoke create, temporary on database $DB_NAME from $APP_ROLE;
revoke $OWNER_ROLE, $MIGRATOR_ROLE from $APP_ROLE;

\connect $DB_NAME
revoke create on schema public from public;
update crm_atendimento.commercial_policy_config
   set commercial_contact_writes_enabled = false,
       commercial_contact_canary_identity_ids = '{}'::uuid[]
 where singleton = true;
grant usage, create on schema crm_atendimento, crm_caixa, harmonia to $MIGRATOR_ROLE;
grant usage on schema crm_atendimento, crm_caixa, harmonia to $APP_ROLE;
revoke create on schema public, crm_atendimento, crm_caixa, harmonia from $APP_ROLE;
revoke all on all tables in schema crm_atendimento, crm_caixa, harmonia from public;
grant select on all tables in schema crm_atendimento, crm_caixa to $APP_ROLE;
revoke all on all tables in schema harmonia from $APP_ROLE;
grant select (phone_raw, opted_out_at) on table harmonia.contacts to $APP_ROLE;
revoke insert, update, delete, truncate, references, trigger on all tables in schema crm_atendimento, crm_caixa, harmonia from $APP_ROLE;
revoke all on all sequences in schema public, crm_atendimento, crm_caixa, harmonia from public;
revoke all on all sequences in schema public, crm_atendimento, crm_caixa, harmonia from $APP_ROLE;
alter default privileges for role $OWNER_ROLE in schema crm_atendimento, crm_caixa grant select on tables to $APP_ROLE;
alter default privileges for role $OWNER_ROLE in schema crm_atendimento, crm_caixa revoke insert, update, delete, truncate, references, trigger on tables from $APP_ROLE;
alter default privileges for role $OWNER_ROLE in schema crm_atendimento, crm_caixa, harmonia revoke all on sequences from $APP_ROLE;
SQL

app_url="postgresql://${APP_ROLE}:${app_password}@127.0.0.1:5432/${DB_NAME}?sslmode=disable&application_name=crm-atendimento-production-readonly"
migrator_url="postgresql://${MIGRATOR_ROLE}:${migrator_password}@127.0.0.1:5432/${DB_NAME}?sslmode=disable&application_name=atendimento-migration"

umask 0077
tmp_env="$(mktemp)"
tmp_migrator="$(mktemp)"
tmp_control="$(mktemp)"
trap 'rm -f "$tmp_env" "$tmp_migrator" "$tmp_control"' EXIT
cat >"$tmp_env" <<EOF
NODE_ENV=production
CRM_DOMAIN=atendimento
CRM_API_HOST=127.0.0.1
CRM_API_PORT=$PORT
DATABASE_URL="$app_url"
ATENDIMENTO_ACTOR_HMAC_KEY=$actor_key
CRM_ATENDIMENTO_ACTOR_SIGNATURE_VERSION=2
CRM_ATENDIMENTO_READINESS_TOKEN=$readiness_token
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
CRM_ATENDIMENTO_EXPECTED_DATABASE=$DB_NAME
CRM_ATENDIMENTO_EXPECTED_DATABASE_USER=$APP_ROLE
CRM_ATENDIMENTO_COMMERCIAL_WRITES_ENABLED=false
CRM_ATENDIMENTO_SCHEMA_MANAGED=true
CRM_GRACEFUL_SHUTDOWN=true
EOF
cat >"$tmp_migrator" <<EOF
NODE_ENV=production
DATABASE_URL="$migrator_url"
EOF
cat >"$tmp_control" <<EOF
{"schemaVersion":1,"module":"atendimento","state":"maintenance","releaseSha":null,"syntheticOnly":false,"reason":"clientes-production-readonly-pending-release","updatedAt":"$stamp"}
EOF
sudo -n install -m 0640 -o root -g skincos "$tmp_env" "$ATENDIMENTO_CONFIG"
sudo -n install -m 0600 -o root -g root "$tmp_migrator" "$MIGRATOR_CONFIG"
sudo -n install -m 0640 -o root -g skincos "$tmp_control" "$CONTROL_FILE"

echo "Atendimento production read-only contract provisioned: database=$DB_NAME app_role=$APP_ROLE migrator_role=$MIGRATOR_ROLE control_file=$CONTROL_FILE backup=$source_dump"
