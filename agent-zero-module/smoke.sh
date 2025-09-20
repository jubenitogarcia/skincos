#!/usr/bin/env bash
set -euo pipefail
SECRET="${WHATSAPP_WEBHOOK_SECRET:-CHANGE_ME}"
PORT="${AGENT_DAEMON_WEBHOOK_PORT:-${AGENT_ZERO_PORT:-4000}}"
BASE="http://localhost:$PORT"
echo "[smoke] Waiting for health (up to 20s)..."
for i in {1..20}; do
  code=$(curl -s -o /dev/null -w "%{http_code}" "$BASE/health" || true)
  if [ "$code" = "200" ]; then
    echo "[smoke] Health OK (t=$i s)"; break; fi
  sleep 1
done
if [ "$code" != "200" ]; then
  echo "[smoke] FAIL health code=$code"; exit 1
fi
TS=$(date +%s)
BODY=$(cat <<EOF
{
  "event": "message_received",
  "timestamp": $TS,
  "message": {"id": "smoke-$TS", "direction": "inbound", "from": "5511999999999", "body": "oi"}
}
EOF
)
SIG=$(printf '%s' "$BODY" | openssl dgst -sha256 -hmac "$SECRET" | awk '{print $2}')
echo "[smoke] Sending webhook event..."
HDRS=(-H 'Content-Type: application/json' -H "X-Signature: $SIG")
if [ -n "${WEBHOOK_API_KEY:-}" ]; then
  HDRS+=( -H "X-API-Key: ${WEBHOOK_API_KEY}" )
fi
resp=$(curl -s -w '\n%{http_code}' -X POST "$BASE/agent-zero/webhooks/whatsapp" "${HDRS[@]}" -d "$BODY")
body=$(echo "$resp" | head -n1)
status=$(echo "$resp" | tail -n1)
if [ "$status" != "200" ]; then
  echo "[smoke] FAIL webhook status=$status body=$body"; exit 1
fi
echo "[smoke] PASS"
