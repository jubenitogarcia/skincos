#!/bin/bash

# Status do Bot HEADLESS

echo "🤖 Status WhatsApp Bot - MODO HEADLESS"
echo "======================================="

# Verificar se o processo está rodando
if pgrep -f "bot_headless.js" > /dev/null; then
    BOT_PID=$(pgrep -f "bot_headless.js")
    echo "✅ Bot Status: RODANDO HEADLESS (PID: $BOT_PID)"

    # Verificar tempo de execução
    START_TIME=$(ps -o lstart= -p $BOT_PID)
    echo "⏰ Iniciado em: $START_TIME"

    # Verificar API
    if curl -s http://localhost:3001/status > /dev/null; then
        echo "🌐 API Status: ATIVA (http://localhost:3001)"

        echo ""
        echo "🤖 Status HEADLESS:"
        curl -s http://localhost:3001/status | jq -r '
        "🔇 Modo: " + .mode,
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
        "📊 Versão: " + .version,
        "🤖 Headless: " + (if .headless then "ATIVO ✅" else "INATIVO" end)'

        echo ""
        echo "⚡ VANTAGENS MODO HEADLESS:"
        echo "   🔇 Sem janela Chrome aberta"
        echo "   ⚡ Menor consumo de recursos"
        echo "   🤖 Ideal para Agent-Zero"
        echo "   🚀 Performance otimizada"

    else
        echo "❌ API Status: INATIVA"
    fi
else
    echo "❌ Bot Status: PARADO"
    echo ""
    echo "🔧 Para iniciar modo HEADLESS: ./iniciar_headless.sh"
fi

echo ""
echo "📋 Últimas linhas do log:"
echo "-------------------------"
if ls ./logs/bot_headless_*.log 1> /dev/null 2>&1; then
    tail -5 ./logs/bot_headless_*.log | tail -5
else
    echo "Nenhum log HEADLESS encontrado"
fi

echo ""
echo "🔧 Comandos disponíveis:"
echo "   ./iniciar_headless.sh  - Iniciar modo HEADLESS"
echo "   ./parar_headless.sh    - Parar bot HEADLESS"
echo "   ./status_headless.sh   - Este status"
echo "   curl http://localhost:3001/status | jq - Status via API"
