#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
N8N_ROOT="${N8N_ROOT:-$REPO_ROOT/n8n}"
if [[ ! -d "$N8N_ROOT" && -d "$HOME/Automation/n8n" ]]; then
  N8N_ROOT="$HOME/Automation/n8n"
fi

UID_VALUE="$(id -u)"
WATCHDOG_LABEL="com.skincos.whatsapp-watchdog"
NETWORK_FALLBACK_LABEL="com.skincos.network-fallback"
N8N_LABEL="com.jubenito.n8n-evolution"
TUNNEL_LABEL="com.skincos.cloudflared.cs"
EVOLUTION_LABEL="com.skincos.evolution-api"
CRM_LABEL="com.skincos.crm-api"
LEGACY_LABELS=("com.n8n.automation" "com.skincos.cloudflared.wa" "com.skincos.keepawake")
N8N_ENV_FILE="${N8N_ENV_FILE:-$N8N_ROOT/.env}"
ENSURE_STACK_SCRIPT="${ENSURE_STACK_SCRIPT:-$N8N_ROOT/scripts/ensure-whatsapp-stack.sh}"
SETUP_KEEPAWAKE_SCRIPT="$SCRIPT_DIR/setup-mac-awake-service.sh"
SETUP_NETWORK_FALLBACK_SCRIPT="$SCRIPT_DIR/setup-network-fallback-service.sh"
NETWORK_FALLBACK_DAEMON_SCRIPT="$SCRIPT_DIR/network-fallback-daemon.sh"

bootstrap_if_missing() {
  local label="$1"
  local plist="$2"
  if launchctl print "gui/$UID_VALUE/$label" >/dev/null 2>&1; then
    echo "[setup] $label já carregado."
    return 0
  fi
  if [[ ! -f "$plist" ]]; then
    echo "[setup] plist não encontrado: $plist"
    return 1
  fi
  echo "[setup] bootstrap $label"
  launchctl bootstrap "gui/$UID_VALUE" "$plist" || true
}

kickstart_job() {
  local label="$1"
  if launchctl print "gui/$UID_VALUE/$label" >/dev/null 2>&1; then
    echo "[setup] kickstart $label"
    launchctl kickstart -k "gui/$UID_VALUE/$label" || true
  fi
}

disable_legacy() {
  local label="$1"
  if launchctl print "gui/$UID_VALUE/$label" >/dev/null 2>&1; then
    echo "[setup] desativando legado: $label"
    launchctl bootout "gui/$UID_VALUE/$label" || true
  fi
}

upsert_env() {
  local key="$1"
  local value="$2"
  if [[ ! -f "$N8N_ENV_FILE" ]]; then
    touch "$N8N_ENV_FILE"
  fi
  if grep -qE "^${key}=" "$N8N_ENV_FILE"; then
    local tmp_file
    tmp_file="$(mktemp)"
    awk -v key="$key" -v value="$value" 'BEGIN{updated=0} index($0, key"=")==1 {print key"="value; updated=1; next} {print} END{if(updated==0) print key"="value}' "$N8N_ENV_FILE" >"$tmp_file"
    mv "$tmp_file" "$N8N_ENV_FILE"
  else
    printf '\n%s=%s\n' "$key" "$value" >> "$N8N_ENV_FILE"
  fi
}

upsert_env_if_missing() {
  local key="$1"
  local value="$2"
  if [[ ! -f "$N8N_ENV_FILE" ]]; then
    touch "$N8N_ENV_FILE"
  fi
  if ! grep -qE "^${key}=" "$N8N_ENV_FILE"; then
    printf '\n%s=%s\n' "$key" "$value" >> "$N8N_ENV_FILE"
  fi
}

apply_power_defaults() {
  upsert_env "WATCHDOG_MANAGE_KEEPAWAKE" "false"
  upsert_env "KEEPAWAKE_ON_BATTERY" "true"
  upsert_env "KEEPAWAKE_BATTERY_SCHEDULE_ENABLED" "true"
  upsert_env "KEEPAWAKE_BATTERY_START_HOUR" "6"
  upsert_env "KEEPAWAKE_BATTERY_END_HOUR" "22"
  upsert_env "KEEPAWAKE_CHECK_INTERVAL_SEC" "30"
  upsert_env "KEEPAWAKE_IDLE_LOCK_ENABLED" "true"
  upsert_env "KEEPAWAKE_IDLE_LOCK_SEC" "180"
  upsert_env "KEEPAWAKE_IDLE_FORCE_DISPLAY_SLEEP" "true"
  upsert_env "MAC_IDLE_LOCK_SEC" "180"
  upsert_env "MAC_REQUIRE_PASSWORD_ON_LOCK" "true"
}

apply_network_defaults() {
  upsert_env "NETWORK_FALLBACK_ENABLED" "true"
  upsert_env "NETWORK_FALLBACK_CHECK_INTERVAL_SEC" "30"
  upsert_env "NETWORK_FALLBACK_PROBE_URL" "https://cp.cloudflare.com/generate_204"
  upsert_env "NETWORK_FALLBACK_PROBE_TIMEOUT_SEC" "6"
  upsert_env "NETWORK_FALLBACK_SWITCH_COOLDOWN_SEC" "120"
  upsert_env "NETWORK_FALLBACK_AUTO_DETECT_IPHONE" "true"
  upsert_env "NETWORK_FALLBACK_AUTO_PATTERN" "iPhone,Hotspot,Android,Galaxy,Pixel"
  upsert_env_if_missing "NETWORK_FALLBACK_SSIDS" ""
  upsert_env_if_missing "NETWORK_FALLBACK_PRIMARY_SSID" ""
  upsert_env_if_missing "NETWORK_FALLBACK_PRIMARY_PASSWORD" ""
}

[[ -f "$ENSURE_STACK_SCRIPT" ]] && chmod +x "$ENSURE_STACK_SCRIPT"
chmod +x "$SETUP_KEEPAWAKE_SCRIPT"
chmod +x "$SETUP_NETWORK_FALLBACK_SCRIPT"
chmod +x "$NETWORK_FALLBACK_DAEMON_SCRIPT"

apply_power_defaults
apply_network_defaults
bash "$SETUP_KEEPAWAKE_SCRIPT" >/dev/null 2>&1
if ! launchctl print "gui/$UID_VALUE/com.skincos.keepawake.agent" >/dev/null 2>&1; then
  echo "[setup] keepawake agent não carregou na primeira tentativa; retry com logs."
  bash "$SETUP_KEEPAWAKE_SCRIPT"
fi
bash "$SETUP_NETWORK_FALLBACK_SCRIPT" >/dev/null 2>&1
if ! launchctl print "gui/$UID_VALUE/$NETWORK_FALLBACK_LABEL" >/dev/null 2>&1; then
  echo "[setup] network fallback não carregou na primeira tentativa; retry com logs."
  bash "$SETUP_NETWORK_FALLBACK_SCRIPT"
fi

bootstrap_if_missing "$N8N_LABEL" "$HOME/Library/LaunchAgents/com.jubenito.n8n-evolution.plist"
bootstrap_if_missing "$TUNNEL_LABEL" "$HOME/Library/LaunchAgents/com.skincos.cloudflared.cs.plist"
bootstrap_if_missing "$EVOLUTION_LABEL" "$HOME/Library/LaunchAgents/com.skincos.evolution-api.plist"
bootstrap_if_missing "$CRM_LABEL" "$HOME/Library/LaunchAgents/com.skincos.crm-api.plist"
bootstrap_if_missing "$WATCHDOG_LABEL" "$HOME/Library/LaunchAgents/com.skincos.whatsapp-watchdog.plist"
bootstrap_if_missing "$NETWORK_FALLBACK_LABEL" "$HOME/Library/LaunchAgents/com.skincos.network-fallback.plist"

# Reload n8n job to apply updated EnvironmentVariables (N8N_MANAGE_EVOLUTION=0).
if launchctl print "gui/$UID_VALUE/$N8N_LABEL" >/dev/null 2>&1; then
  launchctl bootout "gui/$UID_VALUE/$N8N_LABEL" || true
  launchctl bootstrap "gui/$UID_VALUE" "$HOME/Library/LaunchAgents/com.jubenito.n8n-evolution.plist" || true
fi

kickstart_job "$N8N_LABEL"
kickstart_job "$TUNNEL_LABEL"
kickstart_job "$EVOLUTION_LABEL"
kickstart_job "$CRM_LABEL"
kickstart_job "$WATCHDOG_LABEL"
kickstart_job "$NETWORK_FALLBACK_LABEL"

for legacy in "${LEGACY_LABELS[@]}"; do
  disable_legacy "$legacy"
done

if ! launchctl print "gui/$UID_VALUE/com.skincos.keepawake.agent" >/dev/null 2>&1; then
  echo "[setup] keepawake agent ausente após reload; reativando."
  bash "$SETUP_KEEPAWAKE_SCRIPT" >/dev/null 2>&1 || true
fi

echo "[setup] concluído."
