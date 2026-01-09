#!/usr/bin/env bash
# Automated verification of webhook + Redis + metrics
set -euo pipefail

SECRET=${WHATSAPP_WEBHOOK_SECRET:-AGZ_SECRET_123}
WEBHOOK_URL=${WEBHOOK_URL:-http://localhost:50001/agent-zero/webhooks/whatsapp}
DB_URL=${REDIS_URL:-redis://localhost:6379/1}
TMP=$(mktemp)

send(){
  local BODY=$1; local LABEL=$2; local ID_HEADER=$3; local TYPE="message_received"
  local SIG=$(printf '%s' "$BODY" | openssl dgst -sha256 -hmac "$SECRET" | awk '{print $2}')
  echo "\n==> $LABEL"
  curl -s -o $TMP -w "HTTP %{http_code}\n" -X POST "$WEBHOOK_URL" \
    -H "Content-Type: application/json" -H "X-Signature: $SIG" \
    -H "X-Event-Id: $ID_HEADER" -H "X-Event-Type: $TYPE" -d "$BODY"
  cat $TMP | jq . 2>/dev/null || cat $TMP
}

TS_NOW=$(date +%s)
ID1="verif-$(uuidgen | tr 'A-Z' 'a-z')"
BODY1=$(jq -n --arg id "$ID1" --arg body "pedido status de teste" --argjson ts $TS_NOW '{event:"message_received",timestamp:$ts,message:{id:$id,direction:"inbound",from:"5511999999999",body:$body}}')

# 1 válido
send "$BODY1" "Valid event" "$ID1"
# 2 duplicado
send "$BODY1" "Duplicate event (should be duplicate)" "$ID1"
# 3 assinatura inválida (alterar body sem recalcular)
BODY_BAD='{"event":"message_received","timestamp":'$TS_NOW',"message":{"id":"'$ID1'","direction":"inbound","from":"5511999999999","body":"pedido status de teste X"}}'
SIG_BAD=deadbeef
echo "\n==> Invalid signature"
curl -s -o $TMP -w "HTTP %{http_code}\n" -X POST "$WEBHOOK_URL" \
  -H "Content-Type: application/json" -H "X-Signature: $SIG_BAD" \
  -H "X-Event-Id: $ID1-bad" -H "X-Event-Type: message_received" -d "$BODY_BAD"
cat $TMP | jq . 2>/dev/null || cat $TMP
# 4 timestamp fora da janela
OLD_TS=$((TS_NOW-4000))
ID2="verif-$(uuidgen | tr 'A-Z' 'a-z')"
BODY_OLD=$(jq -n --arg id "$ID2" --arg body "fora da janela" --argjson ts $OLD_TS '{event:"message_received",timestamp:$ts,message:{id:$id,direction:"inbound",from:"5511999999999",body:$body}}')
send "$BODY_OLD" "Old timestamp (should be rejected)" "$ID2"

sleep 1

echo "\n==> Metrics slice"
curl -s http://localhost:50001/metrics | grep -E 'events_(received|processed|duplicate|intent)_total' || true

if command -v redis-cli >/dev/null 2>&1; then
  DB_IDX=$(python - <<'PY'
import os,urllib.parse as u
url=os.environ.get('REDIS_URL','redis://localhost:6379/1')
print(u.urlparse(url).path.lstrip('/') or '0')
PY
)
  echo "\n==> Redis counters (db $DB_IDX)"
  redis-cli -n "$DB_IDX" MGET stats:processed_success stats:processed_failed || true
fi

echo "\n==> Last debug events"
curl -s http://localhost:50001/agent-zero/debug/events | jq '.[-5:]'

echo "\nDone."
