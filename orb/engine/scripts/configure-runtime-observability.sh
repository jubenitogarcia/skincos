#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck disable=SC1091
source "$ROOT_DIR/scripts/lib/runtime-paths.sh"

timestamp="$(date -u +'%Y%m%dT%H%M%SZ')"
checkpoint_dir="$N8N_RUNTIME_HOME/exports/runtime-observability/$timestamp"
mkdir -p "$checkpoint_dir"
cp -a "$N8N_ENV_FILE" "$checkpoint_dir/n8n.env.before"

upsert_env() {
  local key="$1"
  local value="$2"
  local tmp
  tmp="$(mktemp)"
  awk -v key="$key" -v value="$value" '
    BEGIN { found=0 }
    index($0, key "=") == 1 { if (!found) print key "=" value; found=1; next }
    { print }
    END { if (!found) print key "=" value }
  ' "$N8N_ENV_FILE" > "$tmp"
  cat "$tmp" > "$N8N_ENV_FILE"
  chmod 0640 "$N8N_ENV_FILE"
  rm -f "$tmp"
}

remove_env() {
  local key="$1"
  local tmp
  tmp="$(mktemp)"
  awk -v key="$key" 'index($0, key "=") != 1 { print }' "$N8N_ENV_FILE" > "$tmp"
  cat "$tmp" > "$N8N_ENV_FILE"
  chmod 0640 "$N8N_ENV_FILE"
  rm -f "$tmp"
}

upsert_env EXECUTIONS_DATA_SAVE_ON_SUCCESS all
upsert_env EXECUTIONS_DATA_SAVE_ON_ERROR all
upsert_env EXECUTIONS_DATA_SAVE_ON_PROGRESS true
upsert_env EXECUTIONS_DATA_SAVE_MANUAL_EXECUTIONS true
upsert_env EXECUTIONS_DATA_PRUNE true
upsert_env EXECUTIONS_DATA_MAX_AGE 720
upsert_env EXECUTIONS_DATA_PRUNE_MAX_COUNT 5000
upsert_env N8N_DEFAULT_BINARY_DATA_MODE filesystem
upsert_env N8N_STORAGE_PATH "$N8N_STORAGE_PATH"
upsert_env N8N_LOG_LEVEL info
upsert_env N8N_LOG_OUTPUT console,file
upsert_env N8N_LOG_FORMAT json
upsert_env N8N_LOG_FILE_COUNT_MAX 30
upsert_env N8N_LOG_FILE_SIZE_MAX 16
upsert_env N8N_LOG_FILE_LOCATION "$N8N_LOG_DIR/n8n.log"
upsert_env CODE_ENABLE_STDOUT false
remove_env N8N_BINARY_DATA_FILE_PATH

logrotate_source="$ROOT_DIR/systemd/system/skincos-runtime.logrotate"
sed \
  -e "s|__N8N_LOG_DIR__|$N8N_LOG_DIR|g" \
  -e "s|__CLOUDFLARED_HOME__|$CLOUDFLARED_HOME|g" \
  "$logrotate_source" | sudo -n tee /etc/logrotate.d/skincos-runtime >/dev/null
sudo -n chmod 0644 /etc/logrotate.d/skincos-runtime
sudo -n logrotate --debug /etc/logrotate.d/skincos-runtime >/dev/null 2>&1

echo "Runtime observability configured."
echo "checkpoint=$checkpoint_dir"
