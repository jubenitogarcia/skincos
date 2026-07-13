#!/bin/bash

# Script para enviar mensagem via API WhatsApp

echo "📱 Enviando mensagem via API WhatsApp..."

# Configurações
API_URL="http://localhost:3001"
NUMERO="5551995103563"
MENSAGEM="teste"

# Verificar se o bot está rodando
echo "🔍 Verificando status do bot..."
STATUS=$(curl -s "${API_URL}/status" | grep -o '"status":"[^"]*"' | cut -d'"' -f4)

if [ "$STATUS" = "ready" ]; then
    echo "✅ Bot está pronto! Enviando mensagem..."

    # Enviar mensagem
    RESPONSE=$(curl -s -X POST "${API_URL}/send" \
        -H "Content-Type: application/json" \
        -d "{
            \"number\": \"${NUMERO}\",
            \"message\": \"${MENSAGEM}\"
        }")

    echo "📤 Resposta da API:"
    echo "$RESPONSE" | python3 -m json.tool 2>/dev/null || echo "$RESPONSE"

else
    echo "❌ Bot não está pronto. Status: $STATUS"
    echo "💡 Certifique-se de que o bot_com_api.js está rodando e autenticado"
fi
