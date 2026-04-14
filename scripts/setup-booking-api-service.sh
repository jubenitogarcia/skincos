#!/usr/bin/env bash
set -euo pipefail

UID_VALUE="$(id -u)"
LABEL="com.skincos.booking-api"
PLIST_PATH="$HOME/Library/LaunchAgents/${LABEL}.plist"
SCRAPER_DIR="/Users/jubenitogarcia/Automation/skincos/backend/apps/automations/scraper"
RUN_SCRIPT="$SCRAPER_DIR/run_booking_api.sh"
ENV_FILE="$SCRAPER_DIR/secrets/booking_api.env"
LOG_DIR="$SCRAPER_DIR/debug"
OUT_LOG="$LOG_DIR/launchd-booking-api.out.log"
ERR_LOG="$LOG_DIR/launchd-booking-api.err.log"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "[booking-api] env não encontrado: $ENV_FILE" >&2
  exit 1
fi

mkdir -p "$HOME/Library/LaunchAgents"
mkdir -p "$LOG_DIR"
chmod +x "$RUN_SCRIPT"

set -a
# shellcheck disable=SC1090
source "$ENV_FILE"
set +a

EF_BOOKING_API_HOST="${EF_BOOKING_API_HOST:-127.0.0.1}"
EF_BOOKING_API_PORT="${EF_BOOKING_API_PORT:-8765}"
HEADLESS="${HEADLESS:-1}"
EF_MODE="${EF_MODE:-booking_api}"
EF_NON_INTERACTIVE="${EF_NON_INTERACTIVE:-1}"

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
    <string>${RUN_SCRIPT}</string>
  </array>

  <key>RunAtLoad</key>
  <true/>

  <key>KeepAlive</key>
  <true/>

  <key>ThrottleInterval</key>
  <integer>10</integer>

  <key>WorkingDirectory</key>
  <string>${SCRAPER_DIR}</string>

  <key>StandardOutPath</key>
  <string>${OUT_LOG}</string>
  <key>StandardErrorPath</key>
  <string>${ERR_LOG}</string>

  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>
    <key>EF_MODE</key>
    <string>${EF_MODE}</string>
    <key>EF_NON_INTERACTIVE</key>
    <string>${EF_NON_INTERACTIVE}</string>
    <key>EF_BOOKING_API_HOST</key>
    <string>${EF_BOOKING_API_HOST}</string>
    <key>EF_BOOKING_API_PORT</key>
    <string>${EF_BOOKING_API_PORT}</string>
    <key>EF_BOOKING_WEBHOOK_SECRET</key>
    <string>${EF_BOOKING_WEBHOOK_SECRET}</string>
    <key>HEADLESS</key>
    <string>${HEADLESS}</string>
  </dict>
</dict>
</plist>
EOF

if launchctl print "gui/$UID_VALUE/$LABEL" >/dev/null 2>&1; then
  launchctl bootout "gui/$UID_VALUE/$LABEL" >/dev/null 2>&1 || true
fi

launchctl bootstrap "gui/$UID_VALUE" "$PLIST_PATH" >/dev/null 2>&1 || true
launchctl kickstart -k "gui/$UID_VALUE/$LABEL" >/dev/null 2>&1 || true

echo "[booking-api] Serviço aplicado: $LABEL"
echo "[booking-api] Plist: $PLIST_PATH"
echo "[booking-api] Endpoint local: http://${EF_BOOKING_API_HOST}:${EF_BOOKING_API_PORT}/healthz"
