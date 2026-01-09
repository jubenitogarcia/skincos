#!/bin/bash

# Script para iniciar WhatsApp Bot em MODO HEADLESS

echo "🤖 Iniciando WhatsApp Bot - MODO HEADLESS"
echo "========================================"

# Parar processos existentes
echo "🛑 Parando bots existentes..."
pkill -f "bot_estavel_macos.js\|bot_headless.js\|teste_servidor.js" 2>/dev/null

# Criar diretório para logs
mkdir -p ./logs

# Verificar se já foi autenticado antes
if [ -d "./.wwebjs_auth" ] && [ -f "./.wwebjs_auth/session/Default/Local Storage/leveldb/CURRENT" ]; then
    echo "✅ Sessão WhatsApp encontrada - Iniciando direto"
    PRIMEIRA_VEZ=false
else
    echo "📱 Primeira execução - QR Code será necessário"
    PRIMEIRA_VEZ=true
fi

echo ""
echo "🔧 Configuração HEADLESS:"
echo "   🔇 Chrome: Invisível (sem janela)"
echo "   🤖 Interação: Apenas via API/Agent-Zero"
echo "   ⚡ Performance: Otimizada"
echo "   📱 QR Code: ${PRIMEIRA_VEZ:+Necessário apenas agora}${PRIMEIRA_VEZ:-Não necessário}"
echo ""

# Iniciar bot headless
echo "🚀 Iniciando bot HEADLESS..."
nohup node bot_headless.js > ./logs/bot_headless_$(date +%Y%m%d_%H%M%S).log 2>&1 &
BOT_PID=$!

echo "✅ Bot HEADLESS iniciado (PID: $BOT_PID)"
echo $BOT_PID > ./logs/bot_headless.pid

# Aguardar inicialização
echo "⏳ Aguardando inicialização..."
sleep 8

# Verificar se está funcionando
if curl -s http://localhost:3001/status > /dev/null; then
    STATUS=$(curl -s http://localhost:3001/status | grep -o '"ready":[^,]*' | cut -d':' -f2)

    if [ "$STATUS" = "true" ]; then
        echo ""
        echo "🎉 SUCCESS! Bot HEADLESS funcionando!"
        echo "=================================="
        echo "✅ Status: CONECTADO"
        echo "🤖 Modo: HEADLESS (sem interface Chrome)"
        echo "🔌 API: http://localhost:3001"
        echo "🤖 Agent-Zero: Pronto para uso"
        echo ""
        echo "📋 IMPORTANTE:"
        echo "   ✅ Nenhuma janela Chrome aberta"
        echo "   🤖 Interação apenas via API"
        echo "   ⚡ Consumo de recursos reduzido"
        echo ""
    else
        QR_STATUS=$(curl -s http://localhost:3001/status | grep -o '"qr":[^,]*' | cut -d':' -f2)
        if [ "$QR_STATUS" = "true" ]; then
            echo ""
            echo "📱 QR CODE NECESSÁRIO (primeira vez)"
            echo "====================================="
            echo "⚠️ Verifique o terminal para escanear QR Code"
            echo "💡 Após escanear, nunca mais aparecerá"
            echo "📋 QR Code também salvo em: ./qr_code.txt"
            echo ""
            echo "⏳ Aguardando autenticação..."
        else
            echo "⏳ Bot iniciando... aguarde mais alguns segundos"
        fi
    fi
else
    echo "❌ Erro ao inicializar. Verificando logs..."
    tail -10 ./logs/bot_headless_*.log
fi

echo ""
echo "🔧 Comandos úteis:"
echo "   ./status_headless.sh    - Ver status"
echo "   ./parar_headless.sh     - Parar bot"
echo "   tail -f ./logs/bot_headless_*.log - Ver logs"
echo ""
echo "🤖 Agent-Zero pode usar a API normalmente!"
