#!/bin/bash

# Script para parar o WhatsApp Bot

echo "🛑 Parando WhatsApp Bot..."

# Parar processo usando PID salvo
if [ -f "./logs/bot.pid" ]; then
    BOT_PID=$(cat ./logs/bot.pid)
    if kill -0 $BOT_PID 2>/dev/null; then
        kill $BOT_PID
        echo "✅ Bot parado (PID: $BOT_PID)"
        rm ./logs/bot.pid
    else
        echo "⚠️ Processo não encontrado pelo PID"
    fi
fi

# Parar qualquer processo restante
pkill -f "bot_estavel_macos.js" 2>/dev/null && echo "✅ Processos adicionais finalizados"

# Verificar se parou
if ! pgrep -f "bot_estavel_macos.js" > /dev/null; then
    echo "✅ WhatsApp Bot completamente parado"
else
    echo "⚠️ Alguns processos ainda podem estar rodando"
fi

echo "📋 Para reiniciar: ./iniciar_background.sh"
