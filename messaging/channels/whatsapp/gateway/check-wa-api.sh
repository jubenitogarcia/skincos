#!/bin/bash

echo "🌐 Verificador DNS - WhatsApp API (wa.skincos.com.br)"
echo "=================================================="
echo ""

echo "📋 CONFIGURAÇÃO DNS NECESSÁRIA:"
echo "1. Acesse: https://dash.cloudflare.com"
echo "2. Selecione: skincos.com.br"
echo "3. Vá em: DNS > Records"
echo "4. Adicione registro CNAME:"
echo "   - Tipo: CNAME"
echo "   - Nome: wa"
echo "   - Destino: d111123b-da44-45f1-adf1-35303be34865.cfargotunnel.com"
echo "   - Proxy: Ativado (nuvem laranja)"
echo ""

echo "🔍 Testando conectividade..."
echo ""

ATTEMPTS=0
MAX_ATTEMPTS=60

while [ $ATTEMPTS -lt $MAX_ATTEMPTS ]; do
    echo "$(date '+%H:%M:%S') - Tentativa $((ATTEMPTS+1))/$MAX_ATTEMPTS - Testando https://wa.skincos.com.br/status"

    if curl -s --max-time 5 https://wa.skincos.com.br/status > /dev/null 2>&1; then
        echo ""
        echo "🎉 SUCCESS! WhatsApp API está online!"
        echo "=================================="
        echo ""
        echo "✅ Status: https://wa.skincos.com.br/status"
        echo ""
        echo "📤 Enviar mensagem:"
        echo "curl -X POST https://wa.skincos.com.br/send \\"
        echo "  -H 'Content-Type: application/json' \\"
        echo "  -d '{\"number\": \"5551999999999\", \"message\": \"Teste via internet!\"}'"
        echo ""
        echo "🌐 Sua API está acessível mundialmente!"
        exit 0
    else
        echo "❌ Ainda não acessível. Aguardando propagação DNS..."
        ATTEMPTS=$((ATTEMPTS+1))
        sleep 10
    fi
done

echo ""
echo "⚠️ Timeout: DNS ainda não propagou após $((MAX_ATTEMPTS*10)) segundos"
echo "Verifique se configurou corretamente no painel Cloudflare."
