#!/bin/bash

# 📱 Script para Obter QR Code do WhatsApp API
# Versão: 2.0.0
# Data: 1 de agosto de 2025

API_URL="http://localhost:3001"

echo "📱 Verificando QR Code do WhatsApp API..."
echo "🌐 API: $API_URL"
echo ""

# Função para verificar se a API está rodando
check_api() {
    if curl -sf "$API_URL/status" > /dev/null; then
        return 0
    else
        return 1
    fi
}

# Aguardar API ficar disponível
printf "⏳ Aguardando API ficar disponível"
while ! check_api; do
    printf "."
    sleep 2
done
echo " ✅"

# Verificar status atual
echo "📊 Status atual:"
curl -s "$API_URL/status" | jq .

echo ""

# Verificar se QR Code está disponível
echo "📱 Verificando QR Code..."
qr_response=$(curl -s "$API_URL/qr")
qr_success=$(echo "$qr_response" | jq -r '.success')

if [ "$qr_success" = "true" ]; then
    echo "✅ QR Code disponível!"

    # Salvar QR Code em arquivo
    echo "$qr_response" | jq -r '.qr' > qr_code_data.txt
    echo "💾 QR Code salvo em: qr_code_data.txt"

    # Tentar abrir QR Code no terminal (se qrencode estiver instalado)
    if command -v qrencode &> /dev/null; then
        echo ""
        echo "📱 QR Code no terminal:"
        echo "$qr_response" | jq -r '.qr' | qrencode -t ANSI
    else
        echo "⚠️  Para ver QR Code no terminal, instale qrencode:"
        echo "   Ubuntu/Debian: sudo apt install qrencode"
        echo "   macOS: brew install qrencode"
    fi

    echo ""
    echo "🌐 Ou acesse: $API_URL/qr no navegador"
    echo "📋 Logs em tempo real: docker-compose logs -f whatsapp-api"

elif [ "$qr_success" = "false" ]; then
    message=$(echo "$qr_response" | jq -r '.message')

    if [[ "$message" == *"já autenticado"* ]]; then
        echo "✅ WhatsApp já está autenticado!"
        echo "🎉 API pronta para uso!"
    else
        echo "⏳ QR Code ainda não disponível: $message"
        echo "💡 Aguarde alguns segundos e tente novamente"
    fi
else
    echo "❌ Erro ao verificar QR Code"
    echo "$qr_response"
fi

echo ""
echo "🔧 Comandos úteis:"
echo "   📊 Status: curl $API_URL/status | jq"
echo "   📱 QR Code: curl $API_URL/qr | jq"
echo "   📋 Logs: docker-compose logs -f whatsapp-api"
echo "   🔄 Reiniciar: docker-compose restart whatsapp-api"
