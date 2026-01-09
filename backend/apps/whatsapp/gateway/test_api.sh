#!/bin/bash

# Script de teste completo da API WhatsApp
set -e

echo "🧪 Testando WhatsApp Bot API..."

BASE_URL="http://localhost:3001"

# Função para testar endpoint
test_endpoint() {
    local endpoint="$1"
    local method="${2:-GET}"
    local data="$3"

    echo "🔍 Testando $method $endpoint"

    if [ "$method" = "GET" ]; then
        response=$(curl -s -w "HTTPSTATUS:%{http_code}" "$BASE_URL$endpoint" 2>/dev/null || echo "HTTPSTATUS:000")
    else
        response=$(curl -s -w "HTTPSTATUS:%{http_code}" -X "$method" \
            -H "Content-Type: application/json" \
            -d "$data" \
            "$BASE_URL$endpoint" 2>/dev/null || echo "HTTPSTATUS:000")
    fi

    http_code=$(echo "$response" | grep -o "HTTPSTATUS:[0-9]*" | cut -d: -f2)
    body=$(echo "$response" | sed 's/HTTPSTATUS:[0-9]*$//')

    if [ "$http_code" -ge 200 ] && [ "$http_code" -lt 300 ]; then
        echo "✅ $endpoint - Status: $http_code"
        if [ ${#body} -lt 200 ]; then
            echo "   Response: $body"
        else
            echo "   Response: $(echo "$body" | cut -c1-100)..."
        fi
    else
        echo "❌ $endpoint - Status: $http_code"
        echo "   Error: $body"
    fi
    echo ""
}

# Verificar se API está rodando
echo "🔍 Verificando se a API está acessível..."
if ! curl -s --connect-timeout 5 "$BASE_URL/status" >/dev/null 2>&1; then
    echo "❌ API não está acessível em $BASE_URL"
    echo "💡 Certifique-se de que o container está rodando: docker-compose ps"
    exit 1
fi

echo "✅ API acessível! Iniciando testes..."
echo ""

# Testes básicos
test_endpoint "/status"
test_endpoint "/qr"
test_endpoint "/chats"
test_endpoint "/info"

# Testes endpoints v1
echo "🔬 Testando endpoints v1..."
test_endpoint "/v1/limits"
test_endpoint "/v1/messages"
test_endpoint "/v1/contacts"
test_endpoint "/v1/conversations"
test_endpoint "/v1/analytics/overview"
test_endpoint "/v1/events"
test_endpoint "/v1/webhooks"
test_endpoint "/v1/channels"

# Teste de envio (comentado para não enviar mensagem real)
echo "📝 Teste de envio de mensagem (simulado):"
echo "   POST /send com payload de teste seria:"
echo '   {"number": "5511999999999", "type": "text", "message": "Teste API"}'
echo ""

# Teste de rate limit
echo "🚦 Testando rate limits..."
test_endpoint "/v1/limits"

echo "✅ Testes concluídos!"
echo ""
echo "📊 Para monitoramento contínuo:"
echo "   Logs: docker-compose logs -f whatsapp-api"
echo "   Status: curl -s $BASE_URL/status | jq ."
echo "   Health: docker-compose ps"
