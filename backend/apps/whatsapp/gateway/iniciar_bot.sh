#!/bin/bash

echo "🚀 INICIANDO NOVA SESSÃO DO WHATSAPP BOT"
echo "======================================"

echo ""
echo "🔍 Verificando pré-requisitos..."

# Verificar se há processos rodando
RUNNING_BOTS=$(ps aux | grep -E "(node.*bot)" | grep -v grep | grep -v "Code Helper")
if [ -n "$RUNNING_BOTS" ]; then
    echo "⚠️ Há processos do bot ainda rodando:"
    echo "$RUNNING_BOTS"
    echo ""
    read -p "Parar processos existentes? (S/n): " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Nn]$ ]]; then
        echo "🛑 Parando sessões existentes..."
        ./parar_sessoes.sh
        sleep 2
    fi
fi

# Verificar porta 3001
PORT_CHECK=$(lsof -ti:3001)
if [ -n "$PORT_CHECK" ]; then
    echo "❌ Porta 3001 em uso pelo processo: $PORT_CHECK"
    echo "Execute primeiro: ./parar_sessoes.sh"
    exit 1
fi

echo "✅ Porta 3001 livre"

# Escolher modo de execução
echo ""
echo "📋 Escolha o modo de execução:"
echo ""
echo "1. 🖥️ Bot Estável (Chrome visível - Recomendado)"
echo "2. 👤 Bot Headless (Chrome invisível)"
echo "3. 🎬 Bot com Interface Web"
echo ""

read -p "Digite sua escolha (1-3): " choice

case $choice in
    1)
        BOT_FILE="bot_estavel_macos.js"
        MODE_NAME="Estável (Chrome Visível)"
        ;;
    2)
        BOT_FILE="bot_headless.js"
        MODE_NAME="Headless (Chrome Invisível)"
        ;;
    3)
        BOT_FILE="bot_estavel_macos.js"
        MODE_NAME="Interface Web"
        ;;
    *)
        echo "❌ Opção inválida, usando modo padrão"
        BOT_FILE="bot_estavel_macos.js"
        MODE_NAME="Estável (Chrome Visível)"
        ;;
esac

# Verificar se arquivo existe
if [ ! -f "$BOT_FILE" ]; then
    echo "❌ Arquivo $BOT_FILE não encontrado!"
    exit 1
fi

echo ""
echo "🎯 Iniciando modo: $MODE_NAME"
echo "📁 Arquivo: $BOT_FILE"
echo ""

# Escolher modo de execução
echo "📋 Como executar:"
echo ""
echo "1. 🖼️ Foreground (ver logs em tempo real)"
echo "2. 🎭 Background (rodar em segundo plano)"
echo ""

read -p "Digite sua escolha (1-2): " exec_choice

case $exec_choice in
    1)
        echo ""
        echo "🚀 Iniciando em foreground..."
        echo "💡 Para parar: Ctrl+C"
        echo "💡 Para segundo plano: Ctrl+Z depois 'bg'"
        echo ""
        sleep 2
        node $BOT_FILE
        ;;
    2)
        echo ""
        echo "🚀 Iniciando em background..."

        # Criar diretório de logs se não existir
        mkdir -p logs

        # Iniciar em background com logs
        nohup node $BOT_FILE > logs/bot_$(date +%Y%m%d_%H%M%S).log 2>&1 &
        BOT_PID=$!

        echo "✅ Bot iniciado em background!"
        echo "📋 PID: $BOT_PID"
        echo "📊 Log: logs/bot_$(date +%Y%m%d_%H%M%S).log"

        # Salvar PID para controle
        echo $BOT_PID > .bot_pid

        echo ""
        echo "⏳ Aguardando inicialização..."
        sleep 5

        # Verificar se está rodando
        if ps -p $BOT_PID > /dev/null; then
            echo "✅ Bot está rodando!"

            # Verificar API
            echo "🔍 Testando API..."
            sleep 3

            if curl -s http://localhost:3001/health | grep -q '"status":"READY"'; then
                echo "✅ API está respondendo!"
                echo "🌐 Interface: http://localhost:3001"
            else
                echo "⏳ API ainda inicializando... (pode levar alguns segundos)"
                echo "🔍 Verificar com: curl http://localhost:3001/health"
            fi

            echo ""
            echo "📋 COMANDOS ÚTEIS:"
            echo "- Ver status: ./status_bot.sh"
            echo "- Ver logs: tail -f logs/bot_$(date +%Y%m%d_%H%M%S).log"
            echo "- Parar bot: ./parar_sessoes.sh"
            echo "- Expor globalmente: ./escolher_opcao_global.sh"

        else
            echo "❌ Erro ao iniciar bot!"
            echo "📋 Verificar logs: cat logs/bot_$(date +%Y%m%d_%H%M%S).log"
        fi
        ;;
    *)
        echo "❌ Opção inválida"
        exit 1
        ;;
esac
