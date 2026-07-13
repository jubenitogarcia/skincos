#!/bin/bash

# Script para verificar status do WhatsApp Bot

echo "📊 Status do WhatsApp Bot:"
echo "================================"

# Verificar se o processo está rodando
if pgrep -f "bot_estavel_macos.js" > /dev/null; then
    BOT_PID=$(pgrep -f "bot_estavel_macos.js")
    echo "✅ Bot Status: RODANDO (PID: $BOT_PID)"

    # Verificar há quanto tempo está rodando
    START_TIME=$(ps -o lstart= -p $BOT_PID)
    echo "⏰ Iniciado em: $START_TIME"

    # Verificar API
    if curl -s http://localhost:3001/status > /dev/null; then
        echo "🌐 API Status: ATIVA (http://localhost:3001)"

        # Obter status detalhado
        echo ""
        echo "📱 Status WhatsApp:"
        curl -s http://localhost:3001/status | jq -r '
        if .ready then
            "✅ WhatsApp: CONECTADO (" + (.user // "usuário") + ")"
        elif .qr then
            "📱 WhatsApp: AGUARDANDO QR CODE"
        elif .error then
            "❌ WhatsApp: ERRO - " + .error
        else
            "⏳ WhatsApp: INICIALIZANDO"
        end,
        "💬 Chats: " + (.chatCount | tostring),
        "📊 Versão: " + .version'
    else
        echo "❌ API Status: INATIVA"
    fi
else
    echo "❌ Bot Status: PARADO"
    echo ""
    echo "🔧 Para iniciar: ./iniciar_background.sh"
fi

echo ""
echo "📋 Últimas 5 linhas do log:"
echo "--------------------------------"
if ls ./logs/bot_*.log 1> /dev/null 2>&1; then
    tail -5 ./logs/bot_*.log | tail -5
else
    echo "Nenhum log encontrado"
fi

echo ""
echo "🔧 Comandos disponíveis:"
echo "   ./iniciar_background.sh - Iniciar bot"
echo "   ./parar_bot.sh - Parar bot"
echo "   ./status_bot.sh - Este status"
