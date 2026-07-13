#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "$SCRIPT_DIR/lib/shared-paths.sh"

UID_VALUE="$(id -u)"
LABEL="com.skincos.keepawake.agent"
PLIST_PATH="$HOME/Library/LaunchAgents/${LABEL}.plist"
LOG_DIR="$N8N_HEALTH_DIR"
OUT_LOG="$LOG_DIR/keepawake.out.log"
ERR_LOG="$LOG_DIR/keepawake.err.log"
DAEMON_SCRIPT="$SKINCOS_SCRIPTS_DIR/keepawake-daemon.sh"

if [[ -f "$N8N_ENV" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "$N8N_ENV"
  set +a
fi

# Padrão: ativo em bateria no horário comercial.
KEEP_AWAKE_ON_BATTERY="${KEEPAWAKE_ON_BATTERY:-true}"
KEEP_AWAKE_BATTERY_SCHEDULE_ENABLED="${KEEPAWAKE_BATTERY_SCHEDULE_ENABLED:-true}"
KEEP_AWAKE_BATTERY_START_HOUR="${KEEPAWAKE_BATTERY_START_HOUR:-6}"
KEEP_AWAKE_BATTERY_END_HOUR="${KEEPAWAKE_BATTERY_END_HOUR:-22}"
KEEP_AWAKE_CHECK_INTERVAL_SEC="${KEEPAWAKE_CHECK_INTERVAL_SEC:-30}"
KEEP_AWAKE_IDLE_LOCK_ENABLED="${KEEPAWAKE_IDLE_LOCK_ENABLED:-true}"
KEEP_AWAKE_IDLE_LOCK_SEC="${KEEPAWAKE_IDLE_LOCK_SEC:-180}"
KEEP_AWAKE_IDLE_FORCE_DISPLAY_SLEEP="${KEEPAWAKE_IDLE_FORCE_DISPLAY_SLEEP:-true}"
MAC_IDLE_LOCK_SEC="${MAC_IDLE_LOCK_SEC:-$KEEP_AWAKE_IDLE_LOCK_SEC}"
MAC_REQUIRE_PASSWORD_ON_LOCK="${MAC_REQUIRE_PASSWORD_ON_LOCK:-true}"

mkdir -p "$HOME/Library/LaunchAgents"
mkdir -p "$LOG_DIR"
chmod +x "$DAEMON_SCRIPT"

to_bool() {
  local value="${1:-false}"
  value="$(printf '%s' "$value" | tr '[:upper:]' '[:lower:]')"
  [[ "$value" == "1" || "$value" == "true" || "$value" == "yes" || "$value" == "on" ]]
}

apply_idle_profile() {
  local idle_seconds="${MAC_IDLE_LOCK_SEC:-180}"
  if [[ ! "$idle_seconds" =~ ^[0-9]+$ ]] || (( idle_seconds < 60 )); then
    idle_seconds=180
  fi
  defaults -currentHost write com.apple.screensaver idleTime -int "$idle_seconds" >/dev/null 2>&1 || true
  if to_bool "$MAC_REQUIRE_PASSWORD_ON_LOCK"; then
    defaults write com.apple.screensaver askForPassword -int 1 >/dev/null 2>&1 || true
    defaults write com.apple.screensaver askForPasswordDelay -int 0 >/dev/null 2>&1 || true
  fi
}

apply_idle_profile

for legacy in "com.skincos.keepawake" "com.skincos.keepawake.test" "com.skincos.keepawake.test2" "com.skincos.keepawake.test3"; do
  launchctl bootout "gui/$UID_VALUE/$legacy" >/dev/null 2>&1 || true
done

cat >"$PLIST_PATH" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${LABEL}</string>

  <key>ProgramArguments</key>
  <array>
    <string>/bin/zsh</string>
    <string>-lc</string>
    <string>${DAEMON_SCRIPT}</string>
  </array>

  <key>RunAtLoad</key>
  <true/>

  <key>KeepAlive</key>
  <true/>

  <key>ProcessType</key>
  <string>Background</string>

  <key>StandardOutPath</key>
  <string>${OUT_LOG}</string>
  <key>StandardErrorPath</key>
  <string>${ERR_LOG}</string>

  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>
    <key>KEEPAWAKE_ON_BATTERY</key>
    <string>${KEEP_AWAKE_ON_BATTERY}</string>
    <key>KEEPAWAKE_BATTERY_SCHEDULE_ENABLED</key>
    <string>${KEEP_AWAKE_BATTERY_SCHEDULE_ENABLED}</string>
    <key>KEEPAWAKE_BATTERY_START_HOUR</key>
    <string>${KEEP_AWAKE_BATTERY_START_HOUR}</string>
    <key>KEEPAWAKE_BATTERY_END_HOUR</key>
    <string>${KEEP_AWAKE_BATTERY_END_HOUR}</string>
    <key>KEEPAWAKE_CHECK_INTERVAL_SEC</key>
    <string>${KEEP_AWAKE_CHECK_INTERVAL_SEC}</string>
    <key>KEEPAWAKE_IDLE_LOCK_ENABLED</key>
    <string>${KEEP_AWAKE_IDLE_LOCK_ENABLED}</string>
    <key>KEEPAWAKE_IDLE_LOCK_SEC</key>
    <string>${KEEP_AWAKE_IDLE_LOCK_SEC}</string>
    <key>KEEPAWAKE_IDLE_FORCE_DISPLAY_SLEEP</key>
    <string>${KEEP_AWAKE_IDLE_FORCE_DISPLAY_SLEEP}</string>
  </dict>
</dict>
</plist>
EOF

if launchctl print "gui/$UID_VALUE/$LABEL" >/dev/null 2>&1; then
  launchctl bootout "gui/$UID_VALUE/$LABEL" >/dev/null 2>&1 || true
fi

launchctl bootstrap "gui/$UID_VALUE" "$PLIST_PATH" >/dev/null 2>&1 || true
launchctl kickstart -k "gui/$UID_VALUE/$LABEL" >/dev/null 2>&1 || true

echo "[keepawake] Serviço aplicado: $LABEL"
echo "[keepawake] Plist: $PLIST_PATH"
echo "[keepawake] Política bateria: ${KEEP_AWAKE_ON_BATTERY}, schedule=${KEEP_AWAKE_BATTERY_SCHEDULE_ENABLED} ${KEEP_AWAKE_BATTERY_START_HOUR}-${KEEP_AWAKE_BATTERY_END_HOUR}"
echo "[keepawake] Idle lock: ${KEEP_AWAKE_IDLE_LOCK_ENABLED}, threshold=${KEEP_AWAKE_IDLE_LOCK_SEC}s, displaySleep=${KEEP_AWAKE_IDLE_FORCE_DISPLAY_SLEEP}"
echo "[keepawake] macOS lock profile: idle=${MAC_IDLE_LOCK_SEC}s, passwordRequired=${MAC_REQUIRE_PASSWORD_ON_LOCK}"
