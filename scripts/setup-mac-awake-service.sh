#!/usr/bin/env bash
set -euo pipefail

UID_VALUE="$(id -u)"
LABEL="com.skincos.keepawake"
PLIST_PATH="$HOME/Library/LaunchAgents/${LABEL}.plist"
LOG_DIR="/Users/jubenitogarcia/Automation/n8n/health"
OUT_LOG="$LOG_DIR/keepawake.out.log"
ERR_LOG="$LOG_DIR/keepawake.err.log"
DAEMON_SCRIPT="/Users/jubenitogarcia/Automation/skincos/scripts/keepawake-daemon.sh"
N8N_ENV="/Users/jubenitogarcia/Automation/n8n/.env"

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

mkdir -p "$HOME/Library/LaunchAgents"
mkdir -p "$LOG_DIR"
chmod +x "$DAEMON_SCRIPT"

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
  </dict>
</dict>
</plist>
EOF

if launchctl print "gui/$UID_VALUE/$LABEL" >/dev/null 2>&1; then
  launchctl bootout "gui/$UID_VALUE/$LABEL" || true
fi

launchctl bootstrap "gui/$UID_VALUE" "$PLIST_PATH" || true
launchctl kickstart -k "gui/$UID_VALUE/$LABEL" || true

echo "[keepawake] Serviço aplicado: $LABEL"
echo "[keepawake] Plist: $PLIST_PATH"
echo "[keepawake] Política bateria: ${KEEP_AWAKE_ON_BATTERY}, schedule=${KEEP_AWAKE_BATTERY_SCHEDULE_ENABLED} ${KEEP_AWAKE_BATTERY_START_HOUR}-${KEEP_AWAKE_BATTERY_END_HOUR}"
