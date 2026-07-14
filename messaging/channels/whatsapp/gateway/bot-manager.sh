#!/bin/bash

# 🚀 WhatsApp Bot Manager - Gerenciamento Completo
# Criado para facilitar o uso no VS Code

echo "🤖 WhatsApp Bot Manager v1.0"
echo "============================="

# Verificar se estamos no diretório correto
if [ ! -f "bot_estavel_macos.js" ]; then
    echo "❌ Erro: Execute este script no diretório do projeto"
    exit 1
fi

# Função para verificar se o bot está rodando
check_bot_status() {
    if [ -f bot.pid ]; then
        PID=$(cat bot.pid)
        if kill -0 $PID 2>/dev/null; then
            return 0  # Rodando
        else
            rm bot.pid  # PID file inválido
            return 1    # Não rodando
        fi
    else
        return 1  # Não rodando
    fi
}

# Função para iniciar o bot
start_bot() {
    if check_bot_status; then
        echo "⚠️  Bot já está rodando (PID: $(cat bot.pid))"
        return
    fi

    echo "🚀 Iniciando WhatsApp Bot..."
    nohup node bot_estavel_macos.js > bot.log 2>&1 &
    echo $! > bot.pid

    # Aguardar um pouco para verificar se iniciou corretamente
    sleep 3

    if check_bot_status; then
        echo "✅ Bot iniciado com sucesso!"
        echo "📋 PID: $(cat bot.pid)"
        echo "📊 Logs: tail -f bot.log"
        echo "🔗 Health: curl http://localhost:3001/health"
        echo "🌐 API: http://localhost:3001"
    else
        echo "❌ Erro ao iniciar o bot. Verifique os logs:"
        tail -n 10 bot.log
    fi
}

# Função para parar o bot
stop_bot() {
    if check_bot_status; then
        PID=$(cat bot.pid)
        echo "🛑 Parando bot (PID: $PID)..."
        kill $PID
        rm bot.pid

        # Aguardar processo parar
        sleep 2

        if ! kill -0 $PID 2>/dev/null; then
            echo "✅ Bot parado com sucesso"
        else
            echo "⚠️  Forçando parada..."
            kill -9 $PID
            echo "✅ Bot forçadamente parado"
        fi
    else
        echo "❌ Bot não está rodando"
    fi
}

# Função para mostrar status
show_status() {
    echo "📊 Status do WhatsApp Bot"
    echo "========================"
    echo "⏰ $(date)"
    echo ""

    if check_bot_status; then
        PID=$(cat bot.pid)
        echo "✅ Status: RODANDO (PID: $PID)"

        # Uso de CPU e memória
        echo "💻 Recursos:"
        ps -p $PID -o pid,ppid,%cpu,%mem,etime,command 2>/dev/null || echo "   Não foi possível obter informações de recursos"

        # Health check
        echo ""
        echo "🔍 Health Check:"
        if curl -s http://localhost:3001/health >/dev/null 2>&1; then
            echo "✅ API respondendo em http://localhost:3001"
            curl -s http://localhost:3001/health | jq . 2>/dev/null || curl -s http://localhost:3001/health
        else
            echo "❌ API não está respondendo"
        fi
    else
        echo "❌ Status: PARADO"
    fi

    # Mostrar últimas linhas do log se existir
    if [ -f bot.log ]; then
        echo ""
        echo "📋 Últimos logs (5 linhas):"
        echo "----------------------------"
        tail -n 5 bot.log
    fi
}

# Função para mostrar logs em tempo real
show_logs() {
    if [ -f bot.log ]; then
        echo "📋 Logs em tempo real (Ctrl+C para sair):"
        echo "==========================================="
        tail -f bot.log
    else
        echo "❌ Arquivo de log não encontrado"
    fi
}

# Função para restart
restart_bot() {
    echo "🔄 Reiniciando bot..."
    stop_bot
    sleep 2
    start_bot
}

# Função para mostrar informações úteis
show_info() {
    echo "ℹ️  Informações do WhatsApp Bot"
    echo "==============================="
    echo "📁 Diretório: $(pwd)"
    echo "📋 Arquivo principal: bot_estavel_macos.js"
    echo "🌐 URL da API: http://localhost:3001"
    echo "📊 Health Check: curl http://localhost:3001/health"
    echo "📋 Logs: tail -f bot.log"
    echo ""
    echo "🎯 Endpoints Principais:"
    echo "  POST /send-message     - Enviar mensagem"
    echo "  POST /send-reaction    - Enviar reação"
    echo "  GET  /contacts         - Listar contatos"
    echo "  GET  /chats           - Listar conversas"
    echo "  GET  /health          - Status da API"
    echo ""
    echo "📱 Para usar com Agent-Zero:"
    echo "  curl -X POST http://localhost:3001/send-message \\"
    echo "    -H 'Content-Type: application/json' \\"
    echo "    -d '{\"number\":\"5511999999999\",\"message\":\"Olá!\"}'"
}

# Menu principal
case "${1:-menu}" in
    "start"|"s")
        start_bot
        ;;
    "stop"|"p")
        stop_bot
        ;;
    "restart"|"r")
        restart_bot
        ;;
    "status"|"st")
        show_status
        ;;
    "logs"|"l")
        show_logs
        ;;
    "info"|"i")
        show_info
        ;;
    "menu"|"m"|"")
        echo ""
        echo "🎯 Comandos disponíveis:"
        echo "======================="
        echo "  ./bot-manager.sh start    (s)  - Iniciar bot"
        echo "  ./bot-manager.sh stop     (p)  - Parar bot"
        echo "  ./bot-manager.sh restart  (r)  - Reiniciar bot"
        echo "  ./bot-manager.sh status   (st) - Mostrar status"
        echo "  ./bot-manager.sh logs     (l)  - Mostrar logs"
        echo "  ./bot-manager.sh info     (i)  - Informações"
        echo "  ./bot-manager.sh menu     (m)  - Este menu"
        echo ""
        echo "💡 Exemplos:"
        echo "  ./bot-manager.sh s        # Iniciar"
        echo "  ./bot-manager.sh st       # Ver status"
        echo "  ./bot-manager.sh l        # Ver logs"
        echo ""
        show_status
        ;;
    *)
        echo "❌ Comando inválido: $1"
        echo "💡 Use: ./bot-manager.sh menu"
        exit 1
        ;;
esac
