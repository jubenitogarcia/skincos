#!/usr/bin/env bash
set -euo pipefail

SECRET=${WHATSAPP_WEBHOOK_SECRET:-AGZ_SECRET_123}
# Porta padrão ajustada para 50001 (modo embutido). Pode sobrescrever WEBHOOK_URL externamente.
WEBHOOK_URL=${WEBHOOK_URL:-http://localhost:50001/agent-zero/webhooks/whatsapp}
FROM_NUMBER=${FROM_NUMBER:-5511999999999}
TEXT=${1:-"oi quero saber status pedido"}
EVENT_TYPE=message_received
TS=$(date +%s)
MSG_ID="dbg-$(uuidgen | tr 'A-Z' 'a-z')"
BODY=$(jq -n --arg id "$MSG_ID" --arg from "$FROM_NUMBER" --arg body "$TEXT" --argjson ts $TS '{event:"message_received",timestamp:$ts,message:{id:$id,direction:"inbound",from:$from,body:$body}}')
SIG=$(printf '%s' "$BODY" | openssl dgst -sha256 -hmac "$SECRET" | awk '{print $2}')

printf 'Sending event id=%s intent-test body="%s"\n' "$MSG_ID" "$TEXT"
API_KEY_HEADER=()
if [ -n "${WEBHOOK_API_KEY:-}" ]; then
  API_KEY_HEADER+=( -H "X-API-Key: $WEBHOOK_API_KEY" )
elif [ -n "${API_KEY:-}" ]; then
  API_KEY_HEADER+=( -H "X-API-Key: $API_KEY" )
fi
RES=$(curl -s -X POST "$WEBHOOK_URL" \
  -H "Content-Type: application/json" -H "X-Signature: $SIG" \
  -H "X-Event-Id: $MSG_ID" -H "X-Event-Type: $EVENT_TYPE" \
  ${API_KEY_HEADER[@]+"${API_KEY_HEADER[@]}"} \
  -d "$BODY")

printf 'Response: %s\n' "$RES"

sleep 1
printf '\nLast events:\n'
curl -s ${DEBUG_EVENTS_URL:-http://localhost:50001/agent-zero/debug/events} | jq '.[-3:]'

printf '\nMetrics slice:\n'
curl -s ${METRICS_URL:-http://localhost:50001/metrics} | grep -E 'events_(received|processed|intent)_total' || true

if command -v redis-cli >/dev/null 2>&1; then
  printf '\nRedis stats (db from REDIS_URL or 1):\n'
  DB_IDX=$(python - <<'PY'
import os,urllib.parse as u
url=os.environ.get('REDIS_URL','redis://localhost:6379/1')
path=u.urlparse(url).path.lstrip('/') or '0'
print(path)
PY
)
  redis-cli -n "$DB_IDX" MGET stats:processed_success stats:processed_failed || true
fi
