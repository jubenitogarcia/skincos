#!/bin/bash

# Script de Teste da API WhatsApp - Envio de Imagens
# Execute: bash test_api_examples.sh

API_URL="http://localhost:3001"
PHONE_NUMBER="5511999999999"  # Substitua pelo seu número

echo "🔍 Testando API WhatsApp - Envio de Mídia"
echo "=========================================="

# Função para verificar status
check_status() {
    echo "📊 Verificando status da API..."
    curl -s -X GET "$API_URL/status" | jq .
    echo ""
}

# Função para enviar texto
send_text() {
    echo "📝 Enviando mensagem de texto..."
    curl -s -X POST "$API_URL/send" \
        -H "Content-Type: application/json" \
        -d "{
            \"number\": \"$PHONE_NUMBER\",
            \"message\": \"🧪 Teste da API - Mensagem de texto\",
            \"type\": \"text\"
        }" | jq .
    echo ""
}

# Função para enviar imagem
send_image() {
    echo "🖼️ Enviando imagem..."
    curl -s -X POST "$API_URL/send" \
        -H "Content-Type: application/json" \
        -d "{
            \"number\": \"$PHONE_NUMBER\",
            \"type\": \"image\",
            \"url\": \"https://picsum.photos/400/300\",
            \"message\": \"🖼️ Imagem de teste enviada via API\"
        }" | jq .
    echo ""
}

# Função para enviar vídeo
send_video() {
    echo "🎥 Enviando vídeo..."
    curl -s -X POST "$API_URL/send" \
        -H "Content-Type: application/json" \
        -d "{
            \"number\": \"$PHONE_NUMBER\",
            \"type\": \"video\",
            \"url\": \"https://sample-videos.com/zip/10/mp4/SampleVideo_1280x720_1mb.mp4\",
            \"message\": \"🎥 Vídeo de teste enviado via API\"
        }" | jq .
    echo ""
}

# Função para enviar áudio
send_audio() {
    echo "🔊 Enviando áudio..."
    curl -s -X POST "$API_URL/send" \
        -H "Content-Type: application/json" \
        -d "{
            \"number\": \"$PHONE_NUMBER\",
            \"type\": \"audio\",
            \"url\": \"https://www.soundjay.com/misc/sounds/bell-ringing-05.wav\"
        }" | jq .
    echo ""
}

# Função para enviar documento
send_document() {
    echo "📄 Enviando documento..."
    curl -s -X POST "$API_URL/send" \
        -H "Content-Type: application/json" \
        -d "{
            \"number\": \"$PHONE_NUMBER\",
            \"type\": \"document\",
            \"url\": \"https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf\"
        }" | jq .
    echo ""
}

# Função para enviar localização
send_location() {
    echo "📍 Enviando localização..."
    curl -s -X POST "$API_URL/send" \
        -H "Content-Type: application/json" \
        -d "{
            \"number\": \"$PHONE_NUMBER\",
            \"type\": \"location\",
            \"latitude\": \"-23.5505\",
            \"longitude\": \"-46.6333\",
            \"location_name\": \"São Paulo\",
            \"location_address\": \"São Paulo, SP, Brasil\"
        }" | jq .
    echo ""
}

# Função para testar webhook
test_webhook() {
    echo "🔗 Testando webhook..."
    curl -s -X POST "$API_URL/webhook" \
        -H "Content-Type: application/json" \
        -d "{
            \"target\": \"$PHONE_NUMBER\",
            \"message\": \"🚨 Alerta do sistema!\",
            \"data\": {
                \"type\": \"notification\",
                \"priority\": \"high\",
                \"source\": \"monitoring\"
            }
        }" | jq .
    echo ""
}

# Executar todos os testes
main() {
    echo "ℹ️ IMPORTANTE: Altere a variável PHONE_NUMBER no topo do script"
    echo "   Número atual configurado: $PHONE_NUMBER"
    echo ""

    read -p "Pressione Enter para continuar ou Ctrl+C para cancelar..."
    echo ""

    check_status

    echo "Aguardando 2 segundos entre cada teste..."
    sleep 2

    send_text
    sleep 2

    send_image
    sleep 2

    send_video
    sleep 2

    send_audio
    sleep 2

    send_document
    sleep 2

    send_location
    sleep 2

    test_webhook

    echo "✅ Todos os testes foram executados!"
    echo ""
    echo "🔍 Para verificar se funcionou:"
    echo "   - Abra o WhatsApp no seu celular"
    echo "   - Verifique as mensagens recebidas"
    echo "   - As imagens/vídeos devem aparecer como mídia"
}

# Verificar se jq está instalado
if ! command -v jq &> /dev/null; then
    echo "⚠️ jq não está instalado. Instale com:"
    echo "   Ubuntu/Debian: sudo apt install jq"
    echo "   macOS: brew install jq"
    echo "   Windows: choco install jq"
    echo ""
    echo "Continuando sem formatação JSON..."
    # Remover jq dos comandos se não estiver disponível
    sed -i 's/| jq \.//g' "$0"
fi

# Executar função principal
main
