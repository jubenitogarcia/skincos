#!/usr/bin/env bash
set -euo pipefail

UID_VALUE="$(id -u)"
LABEL="com.skincos.network-fallback"
PLIST_PATH="$HOME/Library/LaunchAgents/${LABEL}.plist"
LOG_DIR="/Users/jubenitogarcia/Automation/n8n/health"
OUT_LOG="$LOG_DIR/network-fallback.out.log"
ERR_LOG="$LOG_DIR/network-fallback.err.log"
DAEMON_SCRIPT="/Users/jubenitogarcia/Automation/skincos/scripts/network-fallback-daemon.sh"
N8N_ENV="/Users/jubenitogarcia/Automation/n8n/.env"

if [[ -f "$N8N_ENV" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "$N8N_ENV"
  set +a
fi

NETWORK_FALLBACK_ENABLED="${NETWORK_FALLBACK_ENABLED:-true}"
NETWORK_FALLBACK_CHECK_INTERVAL_SEC="${NETWORK_FALLBACK_CHECK_INTERVAL_SEC:-30}"
NETWORK_FALLBACK_PROBE_URL="${NETWORK_FALLBACK_PROBE_URL:-https://cp.cloudflare.com/generate_204}"
NETWORK_FALLBACK_PROBE_TIMEOUT_SEC="${NETWORK_FALLBACK_PROBE_TIMEOUT_SEC:-6}"
NETWORK_FALLBACK_SWITCH_COOLDOWN_SEC="${NETWORK_FALLBACK_SWITCH_COOLDOWN_SEC:-120}"
NETWORK_FALLBACK_SSIDS="${NETWORK_FALLBACK_SSIDS:-}"
NETWORK_FALLBACK_WIFI_INTERFACE="${NETWORK_FALLBACK_WIFI_INTERFACE:-}"
NETWORK_FALLBACK_AUTO_DETECT_IPHONE="${NETWORK_FALLBACK_AUTO_DETECT_IPHONE:-true}"
NETWORK_FALLBACK_AUTO_PATTERN="${NETWORK_FALLBACK_AUTO_PATTERN:-iPhone,Hotspot,Android,Galaxy,Pixel}"
NETWORK_FALLBACK_PRIMARY_SSID="${NETWORK_FALLBACK_PRIMARY_SSID:-}"
NETWORK_FALLBACK_PRIMARY_PASSWORD="${NETWORK_FALLBACK_PRIMARY_PASSWORD:-}"

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
    <key>NETWORK_FALLBACK_ENABLED</key>
    <string>${NETWORK_FALLBACK_ENABLED}</string>
    <key>NETWORK_FALLBACK_CHECK_INTERVAL_SEC</key>
    <string>${NETWORK_FALLBACK_CHECK_INTERVAL_SEC}</string>
    <key>NETWORK_FALLBACK_PROBE_URL</key>
    <string>${NETWORK_FALLBACK_PROBE_URL}</string>
    <key>NETWORK_FALLBACK_PROBE_TIMEOUT_SEC</key>
    <string>${NETWORK_FALLBACK_PROBE_TIMEOUT_SEC}</string>
    <key>NETWORK_FALLBACK_SWITCH_COOLDOWN_SEC</key>
    <string>${NETWORK_FALLBACK_SWITCH_COOLDOWN_SEC}</string>
    <key>NETWORK_FALLBACK_SSIDS</key>
    <string>${NETWORK_FALLBACK_SSIDS}</string>
    <key>NETWORK_FALLBACK_WIFI_INTERFACE</key>
    <string>${NETWORK_FALLBACK_WIFI_INTERFACE}</string>
    <key>NETWORK_FALLBACK_AUTO_DETECT_IPHONE</key>
    <string>${NETWORK_FALLBACK_AUTO_DETECT_IPHONE}</string>
    <key>NETWORK_FALLBACK_AUTO_PATTERN</key>
    <string>${NETWORK_FALLBACK_AUTO_PATTERN}</string>
    <key>NETWORK_FALLBACK_PRIMARY_SSID</key>
    <string>${NETWORK_FALLBACK_PRIMARY_SSID}</string>
    <key>NETWORK_FALLBACK_PRIMARY_PASSWORD</key>
    <string>${NETWORK_FALLBACK_PRIMARY_PASSWORD}</string>
  </dict>
</dict>
</plist>
EOF

if launchctl print "gui/$UID_VALUE/$LABEL" >/dev/null 2>&1; then
  launchctl bootout "gui/$UID_VALUE/$LABEL" >/dev/null 2>&1 || true
fi

launchctl bootstrap "gui/$UID_VALUE" "$PLIST_PATH" >/dev/null 2>&1 || true
launchctl kickstart -k "gui/$UID_VALUE/$LABEL" >/dev/null 2>&1 || true

echo "[network-fallback] Serviço aplicado: $LABEL"
echo "[network-fallback] Plist: $PLIST_PATH"
echo "[network-fallback] Probe: ${NETWORK_FALLBACK_PROBE_URL} (timeout ${NETWORK_FALLBACK_PROBE_TIMEOUT_SEC}s)"
echo "[network-fallback] Check interval: ${NETWORK_FALLBACK_CHECK_INTERVAL_SEC}s | Cooldown: ${NETWORK_FALLBACK_SWITCH_COOLDOWN_SEC}s"
echo "[network-fallback] SSIDs manuais: ${NETWORK_FALLBACK_SSIDS:-<auto detect only>}"
