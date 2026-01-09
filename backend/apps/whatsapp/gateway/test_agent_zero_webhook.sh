#!/usr/bin/env bash
# Testa entrega de webhook WhatsApp -> Agent-Zero
# Uso:
#   chmod +x test_agent_zero_webhook.sh
#   ./test_agent_zero_webhook.sh https://wa.skincos.com.br https://a0.skincos.com.br/agent-zero/webhooks/whatsapp AGZ_SECRET_123
# Args:
#   1 = BASE da API WhatsApp
#   2 = URL pública webhook Agent-Zero
#   3 = Segredo usado no registro (mesmo que Agent-Zero valida)

set -euo pipefail
API_BASE="${1:-http://localhost:3001}"
TARGET_URL="${2:-}"
SECRET="${3:-}"

if [[ -z "$TARGET_URL" || -z "$SECRET" ]]; then
  echo "ERRO: informar API_BASE TARGET_URL SECRET" >&2
  exit 1
fi

echo "[1] Listando webhooks existentes..."
EXISTING=$(curl -s "$API_BASE/v1/webhooks" | jq -r '.data[]?.url' 2>/dev/null || true)
if echo "$EXISTING" | grep -Fq "$TARGET_URL"; then
  echo "Webhook já registrado. Usando existente."
else
  echo "[2] Registrando novo webhook..."
  REG_RESP=$(curl -s -X POST "$API_BASE/v1/webhooks" -H 'Content-Type: application/json' \
    -d "{\"url\":\"$TARGET_URL\",\"secret\":\"$SECRET\",\"events\":[\"message_received\",\"message_sent\",\"message_status_updated\",\"message_annotated\"]}")
  echo "$REG_RESP" | jq '.'
fi

# Captura ID do webhook (o último com aquela URL)
WEBHOOK_ID=$(curl -s "$API_BASE/v1/webhooks" | jq -r --arg U "$TARGET_URL" '.data[] | select(.url==$U) | .id' | tail -1)
if [[ -z "$WEBHOOK_ID" ]]; then
  echo "ERRO: não foi possível obter ID do webhook" >&2
  exit 2
fi

echo "[3] Disparando evento de teste..."
TEST_RESP=$(curl -s -X POST "$API_BASE/v1/webhooks/test" -H 'Content-Type: application/json' -d "{\"id\":\"$WEBHOOK_ID\",\"event\":\"test_event\"}")
echo "$TEST_RESP" | jq '.'

sleep 2

echo "[4] Consultando histórico de deliveries..."
DELIVERIES=$(curl -s "$API_BASE/v1/webhooks/$WEBHOOK_ID/deliveries")
echo "$DELIVERIES" | jq '.'

STATUS=$(echo "$DELIVERIES" | jq -r '.data[0].status // empty')
if [[ "$STATUS" == "ok" ]]; then
  echo "✅ Webhook test_event entregue com sucesso."; exit 0
else
  echo "⚠️ Último status: $STATUS (verifique Agent-Zero logs)."; exit 3
fi
