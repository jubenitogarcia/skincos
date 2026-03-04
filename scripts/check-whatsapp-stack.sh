#!/usr/bin/env bash
set -euo pipefail

EVOLUTION_ENV="/Users/jubenitogarcia/Automation/n8n/evolution-api/.env"
N8N_ENV="/Users/jubenitogarcia/Automation/n8n/.env"
API_KEY="$(grep -E '^AUTHENTICATION_API_KEY=' "$EVOLUTION_ENV" 2>/dev/null | head -n1 | cut -d= -f2- | tr -d '\r' || true)"

if [[ -f "$N8N_ENV" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "$N8N_ENV"
  set +a
fi

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

echo
echo "== launchd =="
launchctl list | grep -E "com.jubenito.n8n-evolution|com.skincos.cloudflared.cs|com.skincos.whatsapp-watchdog" || true
launchctl list | grep -E "com.skincos.evolution-api" || true
launchctl list | grep -E "com.skincos.crm-api" || true

echo
echo "== energia/awake =="
pmset -g custom | sed -n '/AC Power:/,/Battery Power:/p' | sed '$d' || true
UID_VALUE="$(id -u)"
PID_FILE="/Users/jubenitogarcia/Automation/n8n/health/keepawake-assertion.pid"
MODE_FILE="/Users/jubenitogarcia/Automation/n8n/health/keepawake.mode"
if [[ -f "$MODE_FILE" ]]; then
  echo "keepawake mode: $(cat "$MODE_FILE" 2>/dev/null || echo none)"
else
  echo "keepawake mode: none"
fi
if [[ -f "$PID_FILE" ]] && kill -0 "$(cat "$PID_FILE" 2>/dev/null || true)" >/dev/null 2>&1; then
  echo "caffeinate assertion: ativa"
else
  echo "caffeinate assertion: inativa"
fi
echo "keepawake policy: battery=${KEEPAWAKE_ON_BATTERY:-true}, schedule=${KEEPAWAKE_BATTERY_SCHEDULE_ENABLED:-true} ${KEEPAWAKE_BATTERY_START_HOUR:-6}-${KEEPAWAKE_BATTERY_END_HOUR:-22}, ttl=${KEEPAWAKE_ASSERTION_TTL_SEC:-75}s"

echo
echo "== alertas =="
if [[ -n "${ALERT_WEBHOOK_URL:-}" ]] || [[ -n "${ALERT_EMAIL_TO:-}" ]]; then
  echo "Canal de alerta configurado via ambiente carregado."
  echo "Política: delay inicial=${ALERT_INITIAL_DELAY_SEC:-300}s, lembrete=${ALERT_REMINDER_INTERVAL_SEC:-3600}s, recovery=${ALERT_SEND_RECOVERY:-false}"
  echo "           silêncio=${ALERT_QUIET_START_HOUR:-23}-${ALERT_QUIET_END_HOUR:-7}, limite diário=${ALERT_MAX_REMINDERS_PER_DAY:-6}"
else
  echo "Canal de alerta NÃO configurado (use ALERT_WEBHOOK_URL ou SMTP + ALERT_EMAIL_TO no /Users/jubenitogarcia/Automation/n8n/.env)."
fi
