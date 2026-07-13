#!/usr/bin/env bash
set -euo pipefail

echo "🚀 Iniciando segunda instância WhatsApp Gateway"

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
LOG_DIR="$ROOT_DIR"
cd "$ROOT_DIR"

# Configurações da segunda instância (porta reservada fixa 3002)
DEFAULT_PORT=3002
if lsof -i :3002 -sTCP:LISTEN >/dev/null 2>&1; then
	echo "❌ Porta reservada 3002 já está em uso. Libere-a antes de iniciar a segunda instância." >&2
	exit 2
fi
PORT=3002
export PORT
export ACCOUNT_ID="${ACCOUNT_ID:-instance2}"
export WHATSAPP_BASE_URL="http://localhost:${PORT}"
export AGZ_INTERNAL_ENABLE_DIRECT=${AGZ_INTERNAL_ENABLE_DIRECT:-1}
export AGZ_INTERNAL_BASE="${AGZ_INTERNAL_BASE:-http://localhost:50001}"
export AUTH_LOGIN=${AUTH_LOGIN:-admin}
export AUTH_PASSWORD=${AUTH_PASSWORD:-admin}
export WEBHOOK_EMBEDDED=${WEBHOOK_EMBEDDED:-0}
export WHATSAPP_WEBHOOK_SECRET=${WHATSAPP_WEBHOOK_SECRET:-AGZ_SECRET_123}
export AGZ_WEBHOOK_URL="${AGZ_WEBHOOK_URL:-http://localhost:50001/agent-zero/webhooks/whatsapp}"
export WWJS_AUTH_PATH=".wwebjs_auth_instance2"

RUN_CMD=(node bot_com_api.js --authPath "$WWJS_AUTH_PATH")

if pgrep -f "bot_com_api.js --authPath $WWJS_AUTH_PATH" >/dev/null 2>&1; then
	echo "⚠️ Já existe processo rodando com authPath $WWJS_AUTH_PATH"
	exit 1
fi

echo "📁 Sessão: $WWJS_AUTH_PATH"
echo "🌐 Porta: $PORT"
echo "🆔 Account ID: $ACCOUNT_ID"

nohup "${RUN_CMD[@]}" > "$LOG_DIR/gw2.out" 2>&1 &
PID=$!
echo $PID > gw2.pid
echo "🔄 Processo iniciado PID=$PID (logs em gw2.out)"

# Aguardar readiness
ATTEMPTS=20
SLEEP=2
READY=0
for ((i=1;i<=ATTEMPTS;i++)); do
	RESP=$(curl -s --max-time 2 "http://localhost:${PORT}/status" || true)
	if [[ -n "$RESP" ]]; then
		# Tenta validar JSON minimamente
		if echo "$RESP" | grep -q '{'; then
			if command -v jq >/dev/null 2>&1; then
				if echo "$RESP" | jq . >/dev/null 2>&1; then
					echo "✅ Status JSON recebido:"; echo "$RESP" | jq .
					READY=1; break
				else
					echo "ℹ️ Resposta (não JSON válido ainda, tentativa $i/$ATTEMPTS): $RESP"
				fi
			else
				echo "ℹ️ (jq não instalado) Resposta bruta: $RESP"; READY=1; break
			fi
		else
			echo "⏳ Aguardando API (tentativa $i/$ATTEMPTS)..."
		fi
	else
		echo "⏳ API ainda indisponível (tentativa $i/$ATTEMPTS)"
	fi
	sleep $SLEEP
done

if [[ $READY -ne 1 ]]; then
	echo "❌ Não foi possível confirmar readiness na porta $PORT. Veja tail -f gw2.out"
	exit 5
fi

echo "📱 Abra o QR da segunda instância em: http://localhost:${PORT}/qr.html"
echo "📄 Logs em tempo real: tail -f gw2.out"
echo "🛑 Para parar: kill $(cat gw2.pid) && rm gw2.pid" || true
echo "✅ Segunda instância pronta."
