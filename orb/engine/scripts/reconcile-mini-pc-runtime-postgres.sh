#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck disable=SC1091
source "$ROOT_DIR/scripts/lib/runtime-paths.sh"

STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
EXPORT_ROOT="$N8N_RUNTIME_HOME/exports/repair-$STAMP"
REPORT_FILE="$EXPORT_ROOT/report.txt"
CONTRACT_FILE="$EXPORT_ROOT/runtime-contract.redacted.env"
DB_CHECK_FILE="$EXPORT_ROOT/postgres-contract-check.txt"
RESTART_LOG="$EXPORT_ROOT/restart.log"
VALIDATE_LOG="$EXPORT_ROOT/validate.log"

required_keys=(
  "DB_TYPE"
  "DB_POSTGRESDB_HOST"
  "DB_POSTGRESDB_PORT"
  "DB_POSTGRESDB_DATABASE"
  "DB_POSTGRESDB_USER"
  "DB_POSTGRESDB_PASSWORD"
  "DB_POSTGRESDB_SCHEMA"
)

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || {
    echo "Missing required command: $1" >&2
    exit 1
  }
}

require_file() {
  [[ -f "$1" ]] || {
    echo "Missing required file: $1" >&2
    exit 1
  }
}

read_contract_value() {
  local key="$1"
  local line

  line="$(grep -E "^${key}=" "$N8N_ENV_FILE" | tail -n 1 || true)"
  if [[ -z "$line" ]]; then
    return 1
  fi

  printf '%s' "${line#*=}" | tr -d '\r'
}

sql_literal() {
  printf "'%s'" "$(printf '%s' "$1" | sed "s/'/''/g")"
}

sql_identifier() {
  printf '"%s"' "$(printf '%s' "$1" | sed 's/"/""/g')"
}

postgres_superuser_psql() {
  sudo -n -u postgres psql --no-psqlrc -v ON_ERROR_STOP=1 --dbname postgres "$@"
}

runtime_db_psql() {
  PGPASSWORD="$DB_POSTGRESDB_PASSWORD" \
    psql --no-psqlrc \
      -v ON_ERROR_STOP=1 \
      -h "$DB_POSTGRESDB_HOST" \
      -p "$DB_POSTGRESDB_PORT" \
      -U "$DB_POSTGRESDB_USER" \
      -d "$DB_POSTGRESDB_DATABASE" \
      "$@"
}

require_cmd grep
require_cmd psql
require_cmd sed
require_cmd sudo
require_file "$N8N_ENV_FILE"

for key in "${required_keys[@]}"; do
  value="$(read_contract_value "$key" || true)"
  if [[ -z "$value" ]]; then
    echo "Missing required runtime contract entry: $key" >&2
    exit 1
  fi
  printf -v "$key" '%s' "$value"
done

if [[ "$DB_TYPE" != "postgresdb" ]]; then
  echo "This helper expects DB_TYPE=postgresdb in $N8N_ENV_FILE." >&2
  exit 1
fi

case "$DB_POSTGRESDB_HOST" in
  127.0.0.1|localhost|::1) ;;
  *)
    echo "Refusing to reconcile a non-local PostgreSQL host: $DB_POSTGRESDB_HOST" >&2
    exit 1
    ;;
esac

mkdir -p "$EXPORT_ROOT"

db_name_ident="$(sql_identifier "$DB_POSTGRESDB_DATABASE")"
db_user_ident="$(sql_identifier "$DB_POSTGRESDB_USER")"
db_schema_ident="$(sql_identifier "$DB_POSTGRESDB_SCHEMA")"
db_name_lit="$(sql_literal "$DB_POSTGRESDB_DATABASE")"
db_user_lit="$(sql_literal "$DB_POSTGRESDB_USER")"
db_password_lit="$(sql_literal "$DB_POSTGRESDB_PASSWORD")"
db_schema_lit="$(sql_literal "$DB_POSTGRESDB_SCHEMA")"
if [[ "$DB_POSTGRESDB_SCHEMA" == "public" ]]; then
  db_search_path_sql="public"
else
  db_search_path_sql="$db_schema_ident, public"
fi

role_exists="$(postgres_superuser_psql -At -c "select 1 from pg_roles where rolname = $db_user_lit;" || true)"
db_exists="$(postgres_superuser_psql -At -c "select 1 from pg_database where datname = $db_name_lit;" || true)"

cat >"$CONTRACT_FILE" <<EOF
DB_TYPE=$DB_TYPE
DB_POSTGRESDB_HOST=$DB_POSTGRESDB_HOST
DB_POSTGRESDB_PORT=$DB_POSTGRESDB_PORT
DB_POSTGRESDB_DATABASE=$DB_POSTGRESDB_DATABASE
DB_POSTGRESDB_USER=$DB_POSTGRESDB_USER
DB_POSTGRESDB_PASSWORD=[REDACTED]
DB_POSTGRESDB_SCHEMA=$DB_POSTGRESDB_SCHEMA
EOF

{
  echo "repair_timestamp_utc=$STAMP"
  echo "runtime_env_file=$N8N_ENV_FILE"
  echo "runtime_export_root=$EXPORT_ROOT"
  echo "db_host=$DB_POSTGRESDB_HOST"
  echo "db_port=$DB_POSTGRESDB_PORT"
  echo "db_name=$DB_POSTGRESDB_DATABASE"
  echo "db_user=$DB_POSTGRESDB_USER"
  echo "db_schema=$DB_POSTGRESDB_SCHEMA"
  echo "role_exists_before=$([[ "$role_exists" == "1" ]] && echo yes || echo no)"
  echo "database_exists_before=$([[ "$db_exists" == "1" ]] && echo yes || echo no)"
} >"$REPORT_FILE"

if [[ "$role_exists" == "1" ]]; then
  postgres_superuser_psql <<SQL
ALTER ROLE $db_user_ident LOGIN PASSWORD $db_password_lit;
SQL
  echo "role_action=altered" >>"$REPORT_FILE"
else
  postgres_superuser_psql <<SQL
CREATE ROLE $db_user_ident LOGIN PASSWORD $db_password_lit;
SQL
  echo "role_action=created" >>"$REPORT_FILE"
fi

if [[ "$db_exists" == "1" ]]; then
  postgres_superuser_psql <<SQL
ALTER DATABASE $db_name_ident OWNER TO $db_user_ident;
GRANT ALL PRIVILEGES ON DATABASE $db_name_ident TO $db_user_ident;
SQL
  echo "database_action=owner_aligned" >>"$REPORT_FILE"
else
  postgres_superuser_psql <<SQL
CREATE DATABASE $db_name_ident OWNER $db_user_ident;
GRANT ALL PRIVILEGES ON DATABASE $db_name_ident TO $db_user_ident;
SQL
  echo "database_action=created" >>"$REPORT_FILE"
fi

postgres_superuser_psql <<SQL
ALTER ROLE $db_user_ident IN DATABASE $db_name_ident SET search_path TO $db_search_path_sql;
SQL

if [[ "$DB_POSTGRESDB_SCHEMA" == "public" ]]; then
  sudo -n -u postgres psql --no-psqlrc -v ON_ERROR_STOP=1 --dbname "$DB_POSTGRESDB_DATABASE" <<SQL
GRANT USAGE, CREATE ON SCHEMA public TO $db_user_ident;
SQL
  echo "schema_action=grants_refreshed_public" >>"$REPORT_FILE"
else
  sudo -n -u postgres psql --no-psqlrc -v ON_ERROR_STOP=1 --dbname "$DB_POSTGRESDB_DATABASE" <<SQL
CREATE SCHEMA IF NOT EXISTS $db_schema_ident AUTHORIZATION $db_user_ident;
ALTER SCHEMA $db_schema_ident OWNER TO $db_user_ident;
GRANT USAGE, CREATE ON SCHEMA $db_schema_ident TO $db_user_ident;
SQL
  echo "schema_action=owner_aligned" >>"$REPORT_FILE"
fi

runtime_db_psql -At <<SQL >"$DB_CHECK_FILE"
select 'db_user=' || current_user;
select 'db_name=' || current_database();
select 'schema_present=' || exists (
  select 1
  from information_schema.schemata
  where schema_name = $db_schema_lit
);
show search_path;
SQL

echo "db_contract_check=$DB_CHECK_FILE" >>"$REPORT_FILE"

{
  echo "== restart =="
  bash "$ROOT_DIR/scripts/manage-mini-pc-system-services.sh" restart
} | tee "$RESTART_LOG"

{
  echo "== validate =="
  bash "$ROOT_DIR/scripts/validate-mini-pc-system-runtime.sh"
} | tee "$VALIDATE_LOG"

{
  echo "restart_log=$RESTART_LOG"
  echo "validate_log=$VALIDATE_LOG"
  echo "status=success"
} >>"$REPORT_FILE"

echo "Repair evidence saved to: $EXPORT_ROOT"
