#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
N8N_ROOT="${N8N_ROOT:-$REPO_ROOT/n8n}"
if [[ ! -d "$N8N_ROOT" && -d "$HOME/Automation/n8n" ]]; then
  N8N_ROOT="$HOME/Automation/n8n"
fi

EVOLUTION_ENV="${EVOLUTION_ENV:-$N8N_ROOT/evolution-api/.env}"
N8N_ENV="${N8N_ENV:-$N8N_ROOT/.env}"
API_KEY="$(grep -E '^AUTHENTICATION_API_KEY=' "$EVOLUTION_ENV" 2>/dev/null | head -n1 | cut -d= -f2- | tr -d '\r' || true)"

if [[ -f "$N8N_ENV" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "$N8N_ENV"
  set +a
fi

NETWORK_FALLBACK_PROBE_URL="${NETWORK_FALLBACK_PROBE_URL:-https://cp.cloudflare.com/generate_204}"
NETWORK_FALLBACK_STATE="${NETWORK_FALLBACK_STATE:-$N8N_ROOT/health/network-fallback.state}"

detect_wifi_interface() {
  /usr/sbin/networksetup -listallhardwareports 2>/dev/null \
    | awk '/Hardware Port: Wi-Fi/{getline; if($1=="Device:"){print $2; exit}}'
}

current_wifi_ssid() {
  local iface="${1:-}"
  if [[ -z "$iface" ]]; then
    return 0
  fi
  local output
  output="$(/usr/sbin/networksetup -getairportnetwork "$iface" 2>/dev/null || true)"
  if printf '%s' "$output" | grep -qi "not associated"; then
    return 0
  fi
  if [[ "$output" == *": "* ]]; then
    printf '%s' "${output#*: }"
  fi
}

echo "== Processos =="
ps aux | grep -Ei "cloudflared|n8n start|crm-api/server.js|evolution-api" | grep -v grep || true

echo
echo "== Portas =="
lsof -nP -iTCP -sTCP:LISTEN | grep -E ":(8080|8099|5678|5432)\b" || true

echo
echo "== Health local =="
curl -fsS -m 6 http://127.0.0.1:8099/health || echo "CRM local: FAIL"
echo
if [[ -n "$API_KEY" ]]; then
  curl -fsS -m 6 -H "apikey: $API_KEY" http://127.0.0.1:8080/instance/fetchInstances >/dev/null \
    && echo "Evolution local: OK" || echo "Evolution local: FAIL"
else
  echo "Evolution local: FAIL (AUTHENTICATION_API_KEY ausente)"
fi

echo
echo "== Tunnel público =="
curl -fsS -m 8 https://cs-api.skincos.com.br/health || echo "cs-api público: FAIL"
echo
if [[ -n "$API_KEY" ]]; then
  curl -fsS -m 8 -H "apikey: $API_KEY" https://wa.skincos.com.br/instance/fetchInstances >/dev/null \
    && echo "wa.skincos.com.br: OK" || echo "wa.skincos.com.br: FAIL"
fi
curl -fsS -m 8 https://orb.skincos.com.br/healthz || echo "orb.skincos.com.br/healthz: FAIL"

echo
echo "== launchd =="
launchctl list | grep -E "com.jubenito.n8n-evolution|com.skincos.cloudflared.cs|com.skincos.cloudflared.orb|com.skincos.whatsapp-watchdog" || true
launchctl list | grep -E "com.skincos.evolution-api" || true
launchctl list | grep -E "com.skincos.crm-api" || true
launchctl list | grep -E "com.skincos.keepawake.agent" || true
launchctl list | grep -E "com.skincos.network-fallback" || true

echo
echo "== energia/awake =="
pmset -g custom | sed -n '/AC Power:/,/Battery Power:/p' | sed '$d' || true
UID_VALUE="$(id -u)"
if launchctl print "gui/$UID_VALUE/com.skincos.keepawake.agent" 2>/dev/null | grep -q "state = running"; then
  echo "keepawake service: ativo"
else
  echo "keepawake service: inativo"
fi
PID_FILE="${KEEPAWAKE_PID_FILE:-$N8N_ROOT/health/keepawake-caffeinate.pid}"
ASSERTION_ACTIVE="false"
if [[ -f "$PID_FILE" ]]; then
  PID_VALUE="$(cat "$PID_FILE" 2>/dev/null || true)"
  if [[ "$PID_VALUE" =~ ^[0-9]+$ ]] && kill -0 "$PID_VALUE" >/dev/null 2>&1; then
    PID_CMDLINE="$(ps -p "$PID_VALUE" -o args= 2>/dev/null || true)"
    if printf '%s' "$PID_CMDLINE" | grep -q "/usr/bin/caffeinate"; then
      ASSERTION_ACTIVE="true"
    fi
  fi
fi
if [[ "$ASSERTION_ACTIVE" == "true" ]]; then
  echo "caffeinate assertion: ativa"
else
  echo "caffeinate assertion: inativa"
fi
echo "keepawake policy: battery=${KEEPAWAKE_ON_BATTERY:-true}, schedule=${KEEPAWAKE_BATTERY_SCHEDULE_ENABLED:-true} ${KEEPAWAKE_BATTERY_START_HOUR:-6}-${KEEPAWAKE_BATTERY_END_HOUR:-22}, check=${KEEPAWAKE_CHECK_INTERVAL_SEC:-30}s"
echo "                 idle-lock=${KEEPAWAKE_IDLE_LOCK_ENABLED:-true}, threshold=${KEEPAWAKE_IDLE_LOCK_SEC:-180}s, displaySleep=${KEEPAWAKE_IDLE_FORCE_DISPLAY_SLEEP:-true}"
SCREENSAVER_IDLE="$(defaults -currentHost read com.apple.screensaver idleTime 2>/dev/null || echo "n/a")"
SCREENSAVER_PW="$(defaults read com.apple.screensaver askForPassword 2>/dev/null || echo "n/a")"
SCREENSAVER_PW_DELAY="$(defaults read com.apple.screensaver askForPasswordDelay 2>/dev/null || echo "n/a")"
echo "macOS lock profile: idleTime=${SCREENSAVER_IDLE}s, askForPassword=${SCREENSAVER_PW}, askForPasswordDelay=${SCREENSAVER_PW_DELAY}"
echo "                 target idle lock=${MAC_IDLE_LOCK_SEC:-${KEEPAWAKE_IDLE_LOCK_SEC:-180}}s, passwordRequired=${MAC_REQUIRE_PASSWORD_ON_LOCK:-true}"

echo
echo "== alertas =="
if [[ -n "${ALERT_WEBHOOK_URL:-}" ]] || [[ -n "${ALERT_EMAIL_TO:-}" ]]; then
  echo "Canal de alerta configurado via ambiente carregado."
  echo "Política: delay inicial=${ALERT_INITIAL_DELAY_SEC:-300}s, lembrete=${ALERT_REMINDER_INTERVAL_SEC:-3600}s, recovery=${ALERT_SEND_RECOVERY:-false}"
  echo "           silêncio=${ALERT_QUIET_START_HOUR:-23}-${ALERT_QUIET_END_HOUR:-7}, limite diário=${ALERT_MAX_REMINDERS_PER_DAY:-6}"
else
  echo "Canal de alerta NÃO configurado (use ALERT_WEBHOOK_URL ou SMTP + ALERT_EMAIL_TO em \$N8N_ENV)."
fi

echo
echo "== fallback de rede =="
WIFI_IFACE="$(detect_wifi_interface || true)"
WIFI_SSID="$(current_wifi_ssid "$WIFI_IFACE" || true)"
echo "Wi-Fi interface: ${WIFI_IFACE:-n/d}"
echo "Wi-Fi SSID atual: ${WIFI_SSID:-n/d}"
if curl -fsS -m 6 -o /dev/null "$NETWORK_FALLBACK_PROBE_URL"; then
  echo "Probe internet: OK ($NETWORK_FALLBACK_PROBE_URL)"
else
  echo "Probe internet: FAIL ($NETWORK_FALLBACK_PROBE_URL)"
fi
if [[ -f "$NETWORK_FALLBACK_STATE" ]]; then
  echo "Estado daemon:"
  sed -n '1,12p' "$NETWORK_FALLBACK_STATE"
else
  echo "Estado daemon: arquivo não encontrado ($NETWORK_FALLBACK_STATE)"
fi
