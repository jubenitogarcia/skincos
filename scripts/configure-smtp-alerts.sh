#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "$SCRIPT_DIR/lib/shared-paths.sh"

DEFAULT_EMAIL="julianbenitogarcia@gmail.com"
DEFAULT_HOST="smtp.gmail.com"
DEFAULT_PORT="587"
DEFAULT_SERVICE="skincos-alert-smtp"

if [[ ! -f "$N8N_ENV" ]]; then
  echo "[smtp-config] Arquivo não encontrado: $N8N_ENV"
  exit 1
fi

EMAIL="${1:-$DEFAULT_EMAIL}"
HOST="${ALERT_SMTP_HOST:-$DEFAULT_HOST}"
PORT="${ALERT_SMTP_PORT:-$DEFAULT_PORT}"
SERVICE="${ALERT_SMTP_PASS_KEYCHAIN_SERVICE:-$DEFAULT_SERVICE}"

echo "[smtp-config] Configurando SMTP para $EMAIL"
read -r -s -p "Cole a senha de app SMTP (não será exibida): " SMTP_PASS
echo
if [[ -z "$SMTP_PASS" ]]; then
  echo "[smtp-config] Senha vazia. Cancelado."
  exit 1
fi
SMTP_PASS_NORMALIZED="$(printf '%s' "$SMTP_PASS" | tr -d ' -')"
if [[ -n "$SMTP_PASS_NORMALIZED" && "$SMTP_PASS_NORMALIZED" != "$SMTP_PASS" ]]; then
  echo "[smtp-config] Senha normalizada (removidos espaços/hífens)."
fi

security delete-generic-password -s "$SERVICE" -a "$EMAIL" >/dev/null 2>&1 || true
security add-generic-password -U -a "$EMAIL" -s "$SERVICE" -w "$SMTP_PASS_NORMALIZED" >/dev/null
unset SMTP_PASS
unset SMTP_PASS_NORMALIZED

upsert_env() {
  local key="$1"
  local value="$2"
  if grep -q "^${key}=" "$N8N_ENV"; then
    sed -i '' "s#^${key}=.*#${key}=${value}#" "$N8N_ENV"
  else
    printf '%s=%s\n' "$key" "$value" >> "$N8N_ENV"
  fi
}

upsert_env "ALERT_EMAIL_TO" "$EMAIL"
upsert_env "ALERT_EMAIL_FROM" "$EMAIL"
upsert_env "ALERT_SMTP_HOST" "$HOST"
upsert_env "ALERT_SMTP_PORT" "$PORT"
upsert_env "ALERT_SMTP_USER" "$EMAIL"
upsert_env "ALERT_SMTP_TLS" "true"
upsert_env "ALERT_SMTP_PASS" ""
upsert_env "ALERT_SMTP_PASS_KEYCHAIN_SERVICE" "$SERVICE"
upsert_env "ALERT_SMTP_PASS_KEYCHAIN_ACCOUNT" "$EMAIL"
upsert_env "ALERT_INITIAL_DELAY_SEC" "${ALERT_INITIAL_DELAY_SEC:-300}"
upsert_env "ALERT_REMINDER_INTERVAL_SEC" "${ALERT_REMINDER_INTERVAL_SEC:-3600}"
upsert_env "ALERT_SEND_RECOVERY" "${ALERT_SEND_RECOVERY:-false}"
upsert_env "ALERT_QUIET_START_HOUR" "${ALERT_QUIET_START_HOUR:-23}"
upsert_env "ALERT_QUIET_END_HOUR" "${ALERT_QUIET_END_HOUR:-7}"
upsert_env "ALERT_MAX_REMINDERS_PER_DAY" "${ALERT_MAX_REMINDERS_PER_DAY:-6}"

echo "[smtp-config] SMTP salvo no .env e senha armazenada no Keychain."
echo "[smtp-config] Recarregando serviços..."
"$SKINCOS_SCRIPTS_DIR/setup-whatsapp-autostart.sh" >/dev/null

echo "[smtp-config] Testando envio..."
set -a
source "$N8N_ENV"
set +a
python3 "$N8N_SCRIPTS_DIR/send-alert.py" "[SKINCOS][TESTE] SMTP" "Teste SMTP configurado com sucesso."
echo "[smtp-config] Concluído."
