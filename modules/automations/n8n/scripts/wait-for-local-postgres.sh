#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck disable=SC1091
source "$ROOT_DIR/scripts/lib/runtime-paths.sh"

TIMEOUT_SEC="${WAIT_FOR_LOCAL_POSTGRES_TIMEOUT_SEC:-90}"
SLEEP_SEC="${WAIT_FOR_LOCAL_POSTGRES_SLEEP_SEC:-2}"

read_env_value() {
  local file="$1"
  local key="$2"
  local line

  line="$(grep -E "^${key}=" "$file" | tail -n 1 || true)"
  if [[ -z "$line" ]]; then
    return 1
  fi

  printf '%s' "${line#*=}" | tr -d '\r'
}

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || {
    echo "Missing required command: $1" >&2
    exit 1
  }
}

require_cmd grep
require_cmd pg_isready

db_type="$(read_env_value "$N8N_ENV_FILE" "DB_TYPE" || true)"
db_host="$(read_env_value "$N8N_ENV_FILE" "DB_POSTGRESDB_HOST" || true)"
db_port="$(read_env_value "$N8N_ENV_FILE" "DB_POSTGRESDB_PORT" || true)"
db_name="$(read_env_value "$N8N_ENV_FILE" "DB_POSTGRESDB_DATABASE" || true)"
db_user="$(read_env_value "$N8N_ENV_FILE" "DB_POSTGRESDB_USER" || true)"

if [[ "$db_type" != "postgresdb" ]]; then
  exit 0
fi

if [[ -z "$db_host" || -z "$db_port" || -z "$db_name" || -z "$db_user" ]]; then
  echo "PostgreSQL runtime contract is incomplete in $N8N_ENV_FILE." >&2
  exit 1
fi

deadline=$((SECONDS + TIMEOUT_SEC))
while (( SECONDS < deadline )); do
  if pg_isready -h "$db_host" -p "$db_port" -d "$db_name" -U "$db_user" >/dev/null 2>&1; then
    exit 0
  fi
  sleep "$SLEEP_SEC"
done

echo "PostgreSQL did not become ready within ${TIMEOUT_SEC}s: ${db_host}:${db_port}/${db_name}" >&2
exit 1
