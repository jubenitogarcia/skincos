#!/bin/bash

# Parar Bot HEADLESS

echo "🛑 Parando WhatsApp Bot HEADLESS..."

# Parar usando PID salvo
if [ -f "./logs/bot_headless.pid" ]; then
    BOT_PID=$(cat ./logs/bot_headless.pid)
    if kill -0 $BOT_PID 2>/dev/null; then
        kill $BOT_PID
        echo "✅ Bot HEADLESS parado (PID: $BOT_PID)"
        rm ./logs/bot_headless.pid
    else
        echo "⚠️ Processo não encontrado pelo PID"
    fi
fi

# Parar qualquer processo restante
pkill -f "bot_headless.js" 2>/dev/null && echo "✅ Processos HEADLESS finalizados"

# Verificar se parou
if ! pgrep -f "bot_headless.js" > /dev/null; then
    echo "✅ Bot HEADLESS completamente parado"
    echo ""
    echo "🤖 Chrome headless foi finalizado"
    echo "⚡ Recursos liberados"
else
    echo "⚠️ Alguns processos ainda podem estar rodando"
    echo "🔧 Tentando forçar parada..."
    pkill -9 -f "bot_headless.js" 2>/dev/null
fi

echo ""
echo "📋 Para reiniciar:"
echo "   ./iniciar_headless.sh    - Modo HEADLESS"
echo "   ./iniciar_background.sh  - Modo VISUAL"
