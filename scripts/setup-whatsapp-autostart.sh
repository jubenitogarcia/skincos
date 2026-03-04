#!/usr/bin/env bash
set -euo pipefail

UID_VALUE="$(id -u)"
WATCHDOG_LABEL="com.skincos.whatsapp-watchdog"
N8N_LABEL="com.jubenito.n8n-evolution"
TUNNEL_LABEL="com.skincos.cloudflared.cs"
EVOLUTION_LABEL="com.skincos.evolution-api"
CRM_LABEL="com.skincos.crm-api"
LEGACY_LABELS=("com.n8n.automation" "com.skincos.cloudflared.wa" "com.skincos.keepawake")
N8N_ENV_FILE="/Users/jubenitogarcia/Automation/n8n/.env"

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
    sed -i '' "s|^${key}=.*|${key}=${value}|" "$N8N_ENV_FILE"
  else
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

chmod +x /Users/jubenitogarcia/Automation/n8n/scripts/ensure-whatsapp-stack.sh
chmod +x /Users/jubenitogarcia/Automation/skincos/scripts/setup-mac-awake-service.sh

apply_power_defaults
bash /Users/jubenitogarcia/Automation/skincos/scripts/setup-mac-awake-service.sh >/dev/null 2>&1
if ! launchctl print "gui/$UID_VALUE/com.skincos.keepawake.agent" >/dev/null 2>&1; then
  echo "[setup] keepawake agent não carregou na primeira tentativa; retry com logs."
  bash /Users/jubenitogarcia/Automation/skincos/scripts/setup-mac-awake-service.sh
fi

bootstrap_if_missing "$N8N_LABEL" "$HOME/Library/LaunchAgents/com.jubenito.n8n-evolution.plist"
bootstrap_if_missing "$TUNNEL_LABEL" "$HOME/Library/LaunchAgents/com.skincos.cloudflared.cs.plist"
bootstrap_if_missing "$EVOLUTION_LABEL" "$HOME/Library/LaunchAgents/com.skincos.evolution-api.plist"
bootstrap_if_missing "$CRM_LABEL" "$HOME/Library/LaunchAgents/com.skincos.crm-api.plist"
bootstrap_if_missing "$WATCHDOG_LABEL" "$HOME/Library/LaunchAgents/com.skincos.whatsapp-watchdog.plist"

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

for legacy in "${LEGACY_LABELS[@]}"; do
  disable_legacy "$legacy"
done

if ! launchctl print "gui/$UID_VALUE/com.skincos.keepawake.agent" >/dev/null 2>&1; then
  echo "[setup] keepawake agent ausente após reload; reativando."
  bash /Users/jubenitogarcia/Automation/skincos/scripts/setup-mac-awake-service.sh >/dev/null 2>&1 || true
fi

echo "[setup] concluído."
