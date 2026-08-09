#!/usr/bin/bash -p
set -euo pipefail

# Creates the dedicated Clientes database contract. It is intentionally a
# local native operation with a dry-run default; it does not route traffic,
# start a tunnel, enable a module, or write commercial data.
readonly SAFE_PATH='/usr/sbin:/usr/bin:/sbin:/bin'
export PATH="$SAFE_PATH"
unset BASH_ENV ENV CDPATH GLOBIGNORE TMPDIR TMP TEMP \
  HTTP_PROXY HTTPS_PROXY ALL_PROXY NO_PROXY http_proxy https_proxy all_proxy no_proxy

run_sudo_clean() {
  /usr/bin/sudo -n /usr/bin/env -i "PATH=$SAFE_PATH" 'HOME=/nonexistent' 'LANG=C' "$@"
}

run_postgres_clean() {
  /usr/bin/sudo -n -u postgres /usr/bin/env -i "PATH=$SAFE_PATH" 'HOME=/nonexistent' 'LANG=C' "$@"
}

readonly DB_NAME='skincos_clientes_production'
readonly OWNER_ROLE='skincos_clientes_owner'
readonly MIGRATOR_ROLE='skincos_clientes_migrator_login'
readonly APP_ROLE='skincos_clientes_ro'
readonly SERVICE='crm-atendimento-production.service'
readonly CONFIG_DIR='/etc/skincos'
readonly ATENDIMENTO_CONFIG='/etc/skincos/crm-clientes-production-readonly.env'
readonly MIGRATOR_CONFIG='/etc/skincos/crm-clientes-production-migrator.env'
readonly CONTROL_DIR='/etc/skincos/atendimento-production'
readonly CONTROL_FILE='/etc/skincos/atendimento-production/module-control.json'
readonly STATE_ROOT='/var/lib/skincos-runtime/crm-atendimento-production'
readonly LOG_ROOT='/var/log/skincos/crm-atendimento-production'
readonly BACKUP_ROOT='/var/backups/skincos/clientes/production-readonly'
readonly PORT='8110'
readonly SCRIPT_DIR="$(cd -- "$(/usr/bin/dirname -- "${BASH_SOURCE[0]}")" && /usr/bin/pwd -P)"
readonly RUNTIME_GRANT_LOCKDOWN="$SCRIPT_DIR/lockdown-atendimento-production-runtime.sh"

ACTION="${1:-}"
case "$ACTION" in
  --dry-run|--apply) ;;
  *) echo "Usage: $0 --dry-run|--apply" >&2; exit 64 ;;
esac

for command_path in /usr/bin/sudo /usr/bin/env /usr/bin/openssl /usr/bin/install /usr/bin/psql /usr/bin/pg_dump /usr/bin/sha256sum /usr/bin/date /usr/bin/mktemp /usr/bin/chown /usr/bin/chmod /usr/bin/cp /usr/bin/cat /usr/bin/rm /usr/bin/test /usr/bin/systemctl /usr/bin/awk /usr/bin/tr /usr/bin/basename /usr/bin/bash; do
  [[ -x "$command_path" ]] || { echo "Missing required command: $command_path" >&2; exit 1; }
done
run_sudo_clean /usr/bin/true
[[ -x "$RUNTIME_GRANT_LOCKDOWN" ]] || { echo 'Production runtime grant lockdown is unavailable.' >&2; exit 78; }

database_exists() {
  run_postgres_clean /usr/bin/psql --dbname=postgres --tuples-only --no-align --set=ON_ERROR_STOP=1 \
    -c "select exists(select 1 from pg_database where datname = '$DB_NAME')" | /usr/bin/tr -d '[:space:]'
}

backup=''
backup_created=0
tmp_env=''
tmp_migrator=''
tmp_control=''
cleanup_partial_artifacts() {
  if [[ "$backup_created" == '1' && -n "$backup" ]]; then
    run_sudo_clean /usr/bin/rm -f -- "$backup" || true
  fi
  [[ -z "$tmp_env" ]] || /usr/bin/rm -f -- "$tmp_env"
  [[ -z "$tmp_migrator" ]] || /usr/bin/rm -f -- "$tmp_migrator"
  [[ -z "$tmp_control" ]] || /usr/bin/rm -f -- "$tmp_control"
}
trap cleanup_partial_artifacts EXIT
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM

if [[ "$ACTION" == '--dry-run' ]]; then
  exists="$(database_exists)"
  run_postgres_clean /usr/bin/psql --dbname=postgres --tuples-only --no-align --set=ON_ERROR_STOP=1 <<SQL
select 'database_exists=$exists';
select 'role=' || rolname || ':login=' || rolcanlogin || ':read_only=' || coalesce(array_to_string(rolconfig, ','), '')
  from pg_roles where rolname in ('$OWNER_ROLE','$MIGRATOR_ROLE','$APP_ROLE') order by rolname;
SQL
  for target in "$ATENDIMENTO_CONFIG" "$MIGRATOR_CONFIG" "$CONTROL_FILE"; do
    if run_sudo_clean /usr/bin/test -f "$target"; then echo "present=$(/usr/bin/basename "$target")"; else echo "missing=$(/usr/bin/basename "$target")"; fi
  done
  printf 'service=%s database=%s app_role=%s migrator_role=%s port=%s loopback_only=true dry_run=true\n' "$SERVICE" "$DB_NAME" "$APP_ROLE" "$MIGRATOR_ROLE" "$PORT"
  exit 0
fi

service_state="$(run_sudo_clean /usr/bin/systemctl is-active "$SERVICE" 2>/dev/null || true)"
[[ "$service_state" == 'inactive' ]] || { echo 'Production provisioning requires the isolated runtime to be inactive.' >&2; exit 1; }

stamp="$(/usr/bin/date -u +%Y%m%dT%H%M%SZ)"
run_sudo_clean /usr/bin/install -d -m 0750 -o root -g postgres "$BACKUP_ROOT"
if [[ "$(database_exists)" == 't' ]]; then
  backup="$(run_sudo_clean /usr/bin/mktemp "$BACKUP_ROOT/$stamp-$DB_NAME-preapply.XXXXXX.dump")"
  if [[ ! "$backup" =~ ^/var/backups/skincos/clientes/production-readonly/[0-9]{8}T[0-9]{6}Z-skincos_clientes_production-preapply\.[A-Za-z0-9]{6}\.dump$ ]]; then
    echo 'Backup output path was not generated from the fixed contract.' >&2
    exit 1
  fi
  backup_created=1
  run_sudo_clean /usr/bin/chown postgres:postgres "$backup"
  run_postgres_clean /usr/bin/pg_dump --format=custom --no-owner --no-privileges --dbname="$DB_NAME" --file="$backup"
  run_sudo_clean /usr/bin/chown root:root "$backup"
  run_sudo_clean /usr/bin/chmod 0600 "$backup"
  checksum="$(run_sudo_clean /usr/bin/sha256sum "$backup" | /usr/bin/awk '{print $1}')"
  backup_created=0
  printf 'backup_created=true backup_sha256=%s\n' "$checksum"
else
  printf 'backup_created=false checkpoint=new_database\n'
fi

run_sudo_clean /usr/bin/install -d -m 0750 -o root -g skincos "$CONFIG_DIR" "$CONTROL_DIR"
run_sudo_clean /usr/bin/install -d -m 0750 -o skincos -g skincos "$STATE_ROOT" "$STATE_ROOT/var" "$LOG_ROOT"
for target in "$ATENDIMENTO_CONFIG" "$MIGRATOR_CONFIG" "$CONTROL_FILE"; do
  if run_sudo_clean /usr/bin/test -f "$target"; then
    if [[ "$target" == "$CONTROL_FILE" ]]; then
      archive_label='control'
    elif [[ "$target" == "$MIGRATOR_CONFIG" ]]; then
      archive_label='migrator-env'
    else
      archive_label='app-env'
    fi
    archived="$(run_sudo_clean /usr/bin/mktemp "$BACKUP_ROOT/$stamp-$archive_label.XXXXXX")"
    run_sudo_clean /usr/bin/cp -p "$target" "$archived"
    run_sudo_clean /usr/bin/chmod 0600 "$archived"
  fi
done

app_password="$(/usr/bin/openssl rand -hex 32)"
migrator_password="$(/usr/bin/openssl rand -hex 32)"
actor_key="$(/usr/bin/openssl rand -hex 32)"
readiness_token="$(/usr/bin/openssl rand -hex 32)"

run_postgres_clean /usr/bin/psql --dbname=postgres --set=ON_ERROR_STOP=1 <<SQL
do \$\$
begin
  if not exists (select 1 from pg_roles where rolname = '$OWNER_ROLE') then create role $OWNER_ROLE nologin; end if;
  if not exists (select 1 from pg_roles where rolname = '$MIGRATOR_ROLE') then create role $MIGRATOR_ROLE login; end if;
  if not exists (select 1 from pg_roles where rolname = '$APP_ROLE') then create role $APP_ROLE login; end if;
end \$\$;
alter role $OWNER_ROLE nologin;
alter role $MIGRATOR_ROLE login password '$migrator_password';
alter role $MIGRATOR_ROLE connection limit 3;
alter role $APP_ROLE login password '$app_password';
alter role $APP_ROLE set default_transaction_read_only = on;
grant $OWNER_ROLE to $MIGRATOR_ROLE;
SQL

if [[ "$(database_exists)" != 't' ]]; then
  run_postgres_clean /usr/bin/psql --dbname=postgres --set=ON_ERROR_STOP=1 -c "create database $DB_NAME owner $OWNER_ROLE"
fi

run_postgres_clean /usr/bin/psql --dbname="$DB_NAME" --set=ON_ERROR_STOP=1 <<SQL
revoke all on database $DB_NAME from public;
revoke all privileges on database $DB_NAME from $APP_ROLE;
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

run_sudo_clean /usr/bin/bash -p "$RUNTIME_GRANT_LOCKDOWN" --apply

umask 0077
tmp_env="$(/usr/bin/mktemp /tmp/atendimento-production-app-env.XXXXXX)"
tmp_migrator="$(/usr/bin/mktemp /tmp/atendimento-production-migrator-env.XXXXXX)"
tmp_control="$(/usr/bin/mktemp /tmp/atendimento-production-control.XXXXXX)"
[[ -f "$tmp_env" && -O "$tmp_env" && -f "$tmp_migrator" && -O "$tmp_migrator" && -f "$tmp_control" && -O "$tmp_control" ]] || { echo 'Private temporary control artifacts are invalid.' >&2; exit 1; }
/usr/bin/cat >"$tmp_env" <<EOF
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
/usr/bin/cat >"$tmp_migrator" <<EOF
DATABASE_URL=postgresql://$MIGRATOR_ROLE:$migrator_password@127.0.0.1:5432/$DB_NAME?sslmode=require&uselibpqcompat=true&application_name=crm-atendimento-production-migrator
EOF
/usr/bin/cat >"$tmp_control" <<EOF
{"schemaVersion":1,"module":"atendimento","state":"maintenance","releaseSha":null,"readOnly":true,"commercialContactWritesEnabled":false,"syntheticOnly":true,"reason":"clientes-production-readonly-pending-release","updatedAt":"$stamp"}
EOF
run_sudo_clean /usr/bin/install -m 0640 -o root -g skincos "$tmp_env" "$ATENDIMENTO_CONFIG"
run_sudo_clean /usr/bin/install -m 0640 -o root -g skincos "$tmp_migrator" "$MIGRATOR_CONFIG"
run_sudo_clean /usr/bin/install -m 0640 -o root -g skincos "$tmp_control" "$CONTROL_FILE"

printf 'provisioned=true database=%s app_role=%s migrator_role=%s service=%s port=%s control_state=maintenance commercial_writes=false pii_source_access=false\n' "$DB_NAME" "$APP_ROLE" "$MIGRATOR_ROLE" "$SERVICE" "$PORT"
