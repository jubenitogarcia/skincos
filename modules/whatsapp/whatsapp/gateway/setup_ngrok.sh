#!/bin/bash

echo "🚀 CONFIGURAÇÃO NGROK GRÁTIS/PAGO"
echo "================================"

echo ""
echo "💰 OPÇÃO MAIS POPULAR E CONFIÁVEL"
echo "- 🆓 Free: 1 túnel, sessões de 2h"
echo "- 💎 Pro: $8/mês, túneis ilimitados"
echo "- ✅ Muito estável"
echo "- ✅ HTTPS automático"
echo "- ✅ Domínio personalizado (Pro)"
echo ""

# Verificar se ngrok está instalado
if ! command -v ngrok &> /dev/null; then
    echo "📦 Instalando Ngrok..."
    brew install ngrok

    if [ $? -eq 0 ]; then
        echo "✅ Ngrok instalado!"
    else
        echo "❌ Erro na instalação. Instalação manual:"
        echo "https://ngrok.com/download"
        exit 1
    fi
else
    echo "✅ Ngrok já instalado"
fi

echo ""
echo "🔧 CONFIGURAÇÃO:"
echo ""
echo "1. 📝 Acesse: https://ngrok.com/signup"
echo "2. 🆓 Crie conta gratuita"
echo "3. 🔑 Copie seu authtoken do dashboard"
echo "4. ⚙️ Configure com: ngrok authtoken SEU_TOKEN"
echo ""

echo "💡 APÓS CONFIGURAR:"
echo ""

# Verificar se API está rodando
if curl -s http://localhost:3001/health | grep -q '"status":"READY"'; then
    echo "✅ API WhatsApp rodando - Pronto para túnel!"
    echo ""

    echo "🎯 COMANDOS NGROK:"
    echo ""
    echo "# Túnel simples (Free):"
    echo "ngrok http 3001"
    echo ""
    echo "# Túnel com domínio personalizado (Pro):"
    echo "ngrok http 3001 --domain=seu-dominio.ngrok.io"
    echo ""
    echo "# Em background:"
    echo "nohup ngrok http 3001 > ngrok.log 2>&1 &"
    echo ""

    # Verificar se já tem authtoken
    if ngrok authtoken --help &> /dev/null; then
        echo "🤖 TESTAR AGORA (após configurar token):"
        echo "ngrok http 3001"
        echo ""
        echo "Sua URL aparecerá como:"
        echo "https://abc123.ngrok.io"
        echo ""
        echo "Agent-Zero usará:"
        echo "curl -X GET https://abc123.ngrok.io/health"
    fi
else
    echo "❌ API WhatsApp não está rodando!"
    echo "Execute primeiro: node bot_estavel_macos.js"
fi

echo ""
echo "📋 VANTAGENS NGROK:"
echo "- ✅ Interface web em http://localhost:4040"
echo "- ✅ Logs detalhados de requisições"
echo "- ✅ Replay de requisições"
echo "- ✅ Autenticação HTTP (Pro)"
