#!/usr/bin/bash -p
set -euo pipefail

readonly SAFE_PATH='/usr/sbin:/usr/bin:/sbin:/bin'
export PATH="$SAFE_PATH"
unset BASH_ENV ENV CDPATH GLOBIGNORE \
  HTTP_PROXY HTTPS_PROXY ALL_PROXY NO_PROXY http_proxy https_proxy all_proxy no_proxy

# Creates the isolated synthetic staging database contract. Secret material is
# generated in memory and written only to the private native configuration
# file; no value is printed or committed.

ACTION="${1:-}"
if [[ "$ACTION" != "--dry-run" && "$ACTION" != "--apply" ]]; then
  echo "Usage: $0 --dry-run|--apply" >&2
  exit 1
fi

readonly DB_NAME='skincos_staging'
readonly APP_ROLE='skincos_staging_crm_app'
readonly MIGRATOR_ROLE='skincos_staging_migrator_login'
readonly OWNER_ROLE='skincos_staging_crm_owner'
readonly CONFIG_DIR='/etc/skincos'
readonly ATENDIMENTO_CONFIG="$CONFIG_DIR/crm-atendimento-staging.env"
readonly MIGRATOR_CONFIG="$CONFIG_DIR/crm-atendimento-staging-migrator.env"
readonly CONTROL_DIR="$CONFIG_DIR/atendimento-staging"
readonly CONTROL_FILE="$CONTROL_DIR/module-control.json"
readonly STATE_ROOT='/var/lib/skincos-runtime/crm-atendimento'
readonly LOG_ROOT='/var/log/skincos/crm-atendimento'
# Keep configuration/control backups root-private and distinct from the
# PostgreSQL dump directory owned by the postgres group.
readonly BACKUP_ROOT='/var/backups/skincos/clientes/staging-control'

for command_path in /usr/bin/sudo /usr/bin/openssl /usr/bin/install /usr/bin/psql /usr/bin/date /usr/bin/mktemp /usr/bin/cat /usr/bin/rm /usr/bin/cp /usr/bin/basename /usr/bin/test; do
  [[ -x "$command_path" ]] || { echo "Missing required command: $command_path" >&2; exit 1; }
done
/usr/bin/sudo -n true

if [[ "$ACTION" == "--dry-run" ]]; then
  /usr/bin/sudo -n -u postgres /usr/bin/env -i "PATH=$SAFE_PATH" 'HOME=/var/lib/postgresql' 'LANG=C' /usr/bin/psql --dbname=postgres --set=ON_ERROR_STOP=1 --tuples-only --no-align <<SQL
select 'database=' || datname from pg_database where datname = '$DB_NAME';
select 'role=' || rolname || ':login=' || rolcanlogin from pg_roles where rolname in ('$APP_ROLE', '$MIGRATOR_ROLE', '$OWNER_ROLE');
SQL
  for path in "$ATENDIMENTO_CONFIG" "$MIGRATOR_CONFIG" "$CONTROL_FILE"; do
    if /usr/bin/sudo -n /usr/bin/test -f "$path"; then echo "present=$path"; else echo "missing=$path"; fi
  done
  exit 0
fi

stamp="$(/usr/bin/date -u +%Y%m%dT%H%M%SZ)"
/usr/bin/sudo -n /usr/bin/install -d -m 0750 -o root -g skincos "$CONFIG_DIR" "$CONTROL_DIR"
/usr/bin/sudo -n /usr/bin/install -d -m 0750 -o skincos -g skincos "$STATE_ROOT" "$STATE_ROOT/var" "$LOG_ROOT"
/usr/bin/sudo -n /usr/bin/install -d -m 0700 -o root -g root "$BACKUP_ROOT"

for path in "$ATENDIMENTO_CONFIG" "$MIGRATOR_CONFIG" "$CONTROL_FILE"; do
  if /usr/bin/sudo -n /usr/bin/test -f "$path"; then
    /usr/bin/sudo -n /usr/bin/cp -p "$path" "$BACKUP_ROOT/${stamp}-$(/usr/bin/basename "$path")"
  fi
done

app_password="$(/usr/bin/openssl rand -hex 32)"
migrator_password="$(/usr/bin/openssl rand -hex 32)"
actor_key="$(/usr/bin/openssl rand -hex 32)"
readiness_token="$(/usr/bin/openssl rand -hex 32)"

/usr/bin/sudo -n -u postgres /usr/bin/env -i "PATH=$SAFE_PATH" 'HOME=/var/lib/postgresql' 'LANG=C' /usr/bin/psql --dbname=postgres --set=ON_ERROR_STOP=1 --set=app_password="$app_password" --set=migrator_password="$migrator_password" <<SQL
alter role $APP_ROLE password :'app_password';
alter role $MIGRATOR_ROLE password :'migrator_password';
alter role $MIGRATOR_ROLE inherit;
alter role $APP_ROLE noinherit;
alter role $APP_ROLE set default_transaction_read_only = on;
revoke $OWNER_ROLE from $APP_ROLE;
revoke $MIGRATOR_ROLE from $APP_ROLE;
grant $OWNER_ROLE to $MIGRATOR_ROLE;
grant connect, create on database $DB_NAME to $OWNER_ROLE;
grant connect, create on database $DB_NAME to $MIGRATOR_ROLE;
revoke all privileges on database $DB_NAME from $APP_ROLE;
grant connect on database $DB_NAME to $APP_ROLE;

\connect $DB_NAME
grant usage, create on schema crm_atendimento to $MIGRATOR_ROLE;
alter table if exists crm_atendimento.schema_migrations owner to $OWNER_ROLE;
grant select, insert, update, delete on all tables in schema crm_atendimento, crm_caixa to $MIGRATOR_ROLE;
grant usage, select, update on all sequences in schema crm_atendimento, crm_caixa to $MIGRATOR_ROLE;
revoke all privileges on schema crm_atendimento, crm_caixa, crm_sessions, harmonia from $APP_ROLE;
revoke all privileges on all tables in schema crm_atendimento, crm_caixa, crm_sessions, harmonia from $APP_ROLE;
revoke all privileges on all sequences in schema crm_atendimento, crm_caixa, crm_sessions, harmonia from $APP_ROLE;
grant usage on schema crm_atendimento, crm_caixa, crm_sessions to $APP_ROLE;
grant select on all tables in schema crm_atendimento, crm_caixa, crm_sessions to $APP_ROLE;
grant usage, create on schema harmonia to $MIGRATOR_ROLE;
grant select, insert, update, delete on all tables in schema harmonia to $MIGRATOR_ROLE;
grant usage, select, update on all sequences in schema harmonia to $MIGRATOR_ROLE;
alter default privileges for role $OWNER_ROLE in schema crm_atendimento revoke all on tables from $APP_ROLE;
alter default privileges for role $OWNER_ROLE in schema crm_atendimento revoke all on sequences from $APP_ROLE;
alter default privileges for role $OWNER_ROLE in schema crm_atendimento grant select on tables to $APP_ROLE;
alter default privileges for role $MIGRATOR_ROLE in schema crm_atendimento revoke all on tables from $APP_ROLE;
alter default privileges for role $MIGRATOR_ROLE in schema crm_atendimento revoke all on sequences from $APP_ROLE;
alter default privileges for role $MIGRATOR_ROLE in schema crm_atendimento grant select on tables to $APP_ROLE;
alter default privileges for role $OWNER_ROLE in schema harmonia grant select, insert, update, delete on tables to $MIGRATOR_ROLE;
alter default privileges for role $OWNER_ROLE in schema harmonia grant usage, select, update on sequences to $MIGRATOR_ROLE;
SQL

app_url="postgresql://${APP_ROLE}:${app_password}@127.0.0.1:5432/${DB_NAME}?sslmode=require&uselibpqcompat=true&application_name=crm-atendimento-staging"
migrator_url="postgresql://${MIGRATOR_ROLE}:${migrator_password}@127.0.0.1:5432/${DB_NAME}?sslmode=require&uselibpqcompat=true&application_name=atendimento-migration"

umask 0077
tmp_env="$(/usr/bin/mktemp)"
tmp_migrator="$(/usr/bin/mktemp)"
tmp_control="$(/usr/bin/mktemp)"
trap '/usr/bin/rm -f "$tmp_env" "$tmp_migrator" "$tmp_control"' EXIT
/usr/bin/cat >"$tmp_env" <<EOF
NODE_ENV=production
CRM_DOMAIN=atendimento
CRM_API_HOST=127.0.0.1
CRM_API_PORT=8111
DATABASE_URL="$app_url"
ATENDIMENTO_ACTOR_HMAC_KEY=$actor_key
ATENDIMENTO_READINESS_TOKEN=$readiness_token
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
/usr/bin/cat >"$tmp_migrator" <<EOF
NODE_ENV=production
DATABASE_URL="$migrator_url"
EOF
/usr/bin/cat >"$tmp_control" <<EOF
{"schemaVersion":1,"module":"atendimento","state":"maintenance","releaseSha":null,"readOnly":true,"commercialContactWritesEnabled":false,"syntheticOnly":true,"reason":"clientes-staging-read-only-pending-release","updatedAt":"$stamp"}
EOF
/usr/bin/sudo -n /usr/bin/install -m 0640 -o root -g skincos "$tmp_env" "$ATENDIMENTO_CONFIG"
/usr/bin/sudo -n /usr/bin/install -m 0600 -o root -g root "$tmp_migrator" "$MIGRATOR_CONFIG"
/usr/bin/sudo -n /usr/bin/install -m 0640 -o root -g skincos "$tmp_control" "$CONTROL_FILE"

echo "Atendimento staging database contract provisioned: database=$DB_NAME app_role=$APP_ROLE migrator_role=$MIGRATOR_ROLE control_file=$CONTROL_FILE control_state=maintenance commercial_writes=false"
