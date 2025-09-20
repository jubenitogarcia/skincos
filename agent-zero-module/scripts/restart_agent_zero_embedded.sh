#!/usr/bin/env bash
# Reinicia Agent Zero em modo embutido (UI + Webhook) com Redis
set -euo pipefail

PORT=${PORT:-50001}
# Para desabilitar a exigência de API Key no webhook (útil em dev), exporte DISABLE_WEBHOOK_API_KEY=1 antes de rodar o script.
SECRET=${WHATSAPP_WEBHOOK_SECRET:-AGZ_SECRET_123}
REDIS_URL=${REDIS_URL:-redis://localhost:6379/1}
LOG_LEVEL=${LOG_LEVEL:-DEBUG}
QUEUE_BACKEND=${QUEUE_BACKEND:-redis}

echo "[restart] Finalizando processos existentes..."
pkill -f run_ui.py 2>/dev/null || true
pkill -f az_daemon.py 2>/dev/null || true
sleep 1

echo "[restart] Exportando variáveis..."
export WEBHOOK_EMBEDDED=1 \
  WHATSAPP_WEBHOOK_SECRET="$SECRET" \
  QUEUE_BACKEND="$QUEUE_BACKEND" \
  REDIS_URL="$REDIS_URL" \
  LOG_LEVEL="$LOG_LEVEL"

if [ "${DISABLE_WEBHOOK_API_KEY:-1}" = "1" ]; then
  # Esvazia API_KEY / WEBHOOK_API_KEY para que o webhook não exija header X-API-Key
  unset API_KEY WEBHOOK_API_KEY || true
  export API_KEY="" WEBHOOK_API_KEY=""
  echo "[restart] API key desabilitada (sem proteção X-API-Key)."
else
  echo "[restart] Mantendo proteção por API key (defina DISABLE_WEBHOOK_API_KEY=1 para desativar)."
fi

echo "[restart] Iniciando run_ui.py na porta ${PORT}..."
nohup python run_ui.py --host=0.0.0.0 --port=${PORT} > ui_embed.out 2>&1 &
PID=$!
echo "[restart] PID=$PID"

sleep 7

echo "[restart] Ping endpoint:"
if ! curl -s http://localhost:${PORT}/agent-zero/debug/ping | jq .; then
  curl -s http://localhost:${PORT}/agent-zero/debug/ping || true
fi

echo "[restart] Security endpoint:"
if ! curl -s http://localhost:${PORT}/agent-zero/debug/security | jq .; then
  curl -s http://localhost:${PORT}/agent-zero/debug/security || true
fi

echo "[restart] Últimas linhas de log:"; tail -n 25 ui_embed.out || true

echo "[restart] Concluído. Use scripts/send_test_event.sh para testar webhook."
