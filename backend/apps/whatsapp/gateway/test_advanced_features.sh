#!/bin/bash

# 🧪 Script de Teste das Funcionalidades Avançadas da API WhatsApp
# Versão: 2.0.0
# Data: 1 de agosto de 2025

API_URL="https://wa.skincos.com.br"
TEST_NUMBER="5551999999999"
GROUP_ID="120363418303835254@g.us"

echo "🚀 Iniciando testes das funcionalidades avançadas..."
echo "API: $API_URL"
echo "Número de teste: $TEST_NUMBER"
echo ""

# Função para fazer requisições e mostrar resultado
test_endpoint() {
    local title="$1"
    local method="$2"
    local endpoint="$3"
    local data="$4"

    echo "=== $title ==="
    echo "🔧 $method $endpoint"

    if [ "$method" = "GET" ]; then
        response=$(curl -s "$API_URL$endpoint")
    else
        response=$(curl -s -X "$method" "$API_URL$endpoint" \
            -H "Content-Type: application/json" \
            -d "$data")
    fi

    echo "📄 Response:"
    echo "$response" | jq . 2>/dev/null || echo "$response"
    echo ""
    sleep 2
}

# 1. Verificar Status
test_endpoint "Status da API" "GET" "/status" ""

# 2. Obter informações do usuário
test_endpoint "Informações do Usuário" "GET" "/info" ""

# 3. Enviar Texto
test_endpoint "Envio de Texto" "POST" "/send" '{
    "number": "'$TEST_NUMBER'",
    "message": "🧪 Teste automatizado - Mensagem de texto"
}'

# 4. Enviar Imagem
test_endpoint "Envio de Imagem" "POST" "/send" '{
    "number": "'$TEST_NUMBER'",
    "type": "image",
    "url": "https://picsum.photos/400/300?random=test",
    "message": "🖼️ Teste automatizado - Imagem"
}'

# 5. Enviar Vídeo
test_endpoint "Envio de Vídeo" "POST" "/send" '{
    "number": "'$TEST_NUMBER'",
    "type": "video",
    "url": "https://sample-videos.com/zip/10/mp4/SampleVideo_1280x720_1mb.mp4",
    "message": "🎥 Teste automatizado - Vídeo"
}'

# 6. Enviar Localização
test_endpoint "Envio de Localização" "POST" "/send" '{
    "number": "'$TEST_NUMBER'",
    "type": "location",
    "latitude": "-30.0346",
    "longitude": "-51.2177",
    "location_name": "Porto Alegre",
    "location_address": "Centro Histórico, Porto Alegre, RS"
}'

# 7. Enviar Sticker
test_endpoint "Envio de Sticker" "POST" "/send" '{
    "number": "'$TEST_NUMBER'",
    "type": "sticker",
    "url": "https://picsum.photos/200/200?random=sticker"
}'

# 8. Enviar Contato
test_endpoint "Envio de Contato" "POST" "/send-contact" '{
    "number": "'$TEST_NUMBER'",
    "contactPhone": "5551998493563"
}'

# 9. Criar Enquete
test_endpoint "Criação de Enquete" "POST" "/send-poll" '{
    "groupId": "'$GROUP_ID'",
    "question": "🧪 Teste automatizado - Qual a melhor funcionalidade?",
    "options": ["Texto", "Imagem", "Vídeo", "Localização", "Todas"],
    "allowMultipleAnswers": false
}'

# 10. Definir Status
test_endpoint "Definir Status" "POST" "/set-status" '{
    "status": "🤖 Teste automatizado via API - '$( date +"%H:%M:%S" )'"
}'

# 11. Webhook
test_endpoint "Webhook" "POST" "/webhook" '{
    "target": "'$TEST_NUMBER'",
    "message": "🚨 Teste de webhook automatizado",
    "data": {
        "type": "automated_test",
        "timestamp": "'$(date -Iseconds)'",
        "source": "test_script",
        "features_tested": ["text", "image", "video", "location", "sticker", "contact", "poll", "status", "webhook"]
    }
}'

# 12. Listar Chats
test_endpoint "Lista de Chats" "GET" "/chats" ""

echo "✅ Testes concluídos!"
echo "📊 Total de funcionalidades testadas: 12"
echo "🔗 Documentação completa: $API_URL/"
echo ""
echo "Para executar novamente: ./test_advanced_features.sh"
