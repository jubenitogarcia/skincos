#!/bin/bash

# Script para rodar WhatsApp Bot em background permanente
# Pode fechar VS Code depois de executar este script

echo "🚀 Configurando WhatsApp Bot para rodar em background..."

# Verificar se já existe um processo rodando
if pgrep -f "bot_estavel_macos.js" > /dev/null; then
    echo "⚠️ Bot já está rodando. Parando processo anterior..."
    pkill -f "bot_estavel_macos.js"
    sleep 2
fi

# Criar diretório para logs se não existir
mkdir -p ./logs

# Função para iniciar bot
start_bot() {
    echo "🔄 Iniciando WhatsApp Bot..."

    # Usar nohup para rodar independente do terminal
    nohup node bot_estavel_macos.js > ./logs/bot_$(date +%Y%m%d_%H%M%S).log 2>&1 &
    BOT_PID=$!

    echo "✅ Bot iniciado com PID: $BOT_PID"
    echo "📋 Log em: ./logs/bot_$(date +%Y%m%d_%H%M%S).log"

    # Salvar PID para controle
    echo $BOT_PID > ./logs/bot.pid

    return $BOT_PID
}

# Iniciar o bot
start_bot

# Aguardar inicialização
echo "⏳ Aguardando inicialização..."
sleep 5

# Verificar se está funcionando
if curl -s http://localhost:3001/status > /dev/null; then
    echo "✅ Bot funcionando! Interface em: http://localhost:3001"
    echo ""
    echo "📱 IMPORTANTE: Mantenha a janela do Chrome aberta (pode minimizar)"
    echo "🖥️ VS Code pode ser fechado - o bot continuará rodando"
    echo ""
    echo "🔧 Comandos úteis:"
    echo "   Para parar: ./parar_bot.sh"
    echo "   Para status: curl http://localhost:3001/status"
    echo "   Para logs: tail -f ./logs/bot_*.log"
    echo ""
    echo "🚨 Se fechar o Chrome, execute novamente este script"
else
    echo "❌ Erro ao inicializar. Verificando logs..."
    tail -10 ./logs/bot_*.log
fi
