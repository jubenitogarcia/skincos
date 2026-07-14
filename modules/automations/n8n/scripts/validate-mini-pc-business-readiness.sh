#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck disable=SC1091
source "$ROOT_DIR/scripts/lib/runtime-paths.sh"

required_runtime_keys=(
  "DB_TYPE"
)

required_business_keys=(
  "N8N_PUBLIC_BASE_URL"
  "EVOLUTION_BASE_URL"
  "EVOLUTION_INSTANCE_NAME"
  "EVOLUTION_API_KEY"
  "DATABASE_URL"
  "N8N_DEFAULT_UNIT_SLUG"
  "N8N_DEFAULT_UNIT_NAME"
  "GOOGLE_CLIENT_ID"
  "GOOGLE_CLIENT_SECRET"
  "GOOGLE_REDIRECT_URI"
  "N8N_DEFAULT_TEST_PHONE"
)

optional_business_keys=(
  "GOOGLE_CALENDAR_ID"
)

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

require_file() {
  [[ -f "$1" ]] || {
    echo "Missing required file: $1" >&2
    exit 1
  }
}

require_file "$N8N_ENV_FILE"
require_file "$N8N_BUSINESS_ENV_FILE"

missing=()
optional_missing=()

echo "== business runtime contract =="
echo "runtime_env_file=$N8N_ENV_FILE"
echo "business_env_file=$N8N_BUSINESS_ENV_FILE"

for key in "${required_runtime_keys[@]}"; do
  value="$(read_env_value "$N8N_ENV_FILE" "$key" || true)"
  if [[ -z "$value" ]]; then
    missing+=("runtime:$key")
    continue
  fi
  printf '%s=%s\n' "$key" "$value"
done

db_type="$(read_env_value "$N8N_ENV_FILE" "DB_TYPE" || true)"
if [[ -n "$db_type" && "$db_type" != "postgresdb" ]]; then
  echo "Expected DB_TYPE=postgresdb for the shared live runtime, found: $db_type" >&2
  exit 1
fi

for key in "${required_business_keys[@]}"; do
  value="$(read_env_value "$N8N_BUSINESS_ENV_FILE" "$key" || true)"
  if [[ -z "$value" ]]; then
    missing+=("business:$key")
    continue
  fi

  case "$key" in
    GOOGLE_CLIENT_SECRET|EVOLUTION_API_KEY|DATABASE_URL)
      printf '%s=[set]\n' "$key"
      ;;
    *)
      printf '%s=%s\n' "$key" "$value"
      ;;
  esac
done

for key in "${optional_business_keys[@]}"; do
  value="$(read_env_value "$N8N_BUSINESS_ENV_FILE" "$key" || true)"
  if [[ -z "$value" ]]; then
    optional_missing+=("business:$key")
    continue
  fi

  printf '%s=%s\n' "$key" "$value"
done

if [[ "${#missing[@]}" -gt 0 ]]; then
  echo
  echo "Business readiness is incomplete. Missing required values:"
  printf '  %s\n' "${missing[@]}"
  exit 1
fi

echo
if [[ "${#optional_missing[@]}" -gt 0 ]]; then
  echo "Optional business values are still blank:"
  printf '  %s\n' "${optional_missing[@]}"
  echo "These do not block the current shared runtime, but may be required before activating Google Calendar-backed scheduling."
  echo
fi

echo "Business readiness OK."
