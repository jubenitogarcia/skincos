#!/bin/bash

# Script para inicializar o ambiente completo

echo "🤖 Inicializador Completo - WhatsApp Bot com API"
echo "================================================="
echo ""

# Verificar se Node.js está instalado
if ! command -v node &> /dev/null; then
    echo "❌ Node.js não encontrado! Instale o Node.js primeiro."
    exit 1
fi

echo "✅ Node.js encontrado: $(node --version)"

# Verificar se as dependências estão instaladas
if [ ! -d "node_modules" ]; then
    echo "📦 Instalando dependências..."
    npm install
    echo "✅ Dependências instaladas!"
else
    echo "✅ Dependências já instaladas"
fi

echo ""
echo "🚀 Escolha uma opção:"
echo ""
echo "1. Bot Básico (meu_bot.js)"
echo "2. Bot Avançado (bot_avancado.js)"
echo "3. Bot com API REST (bot_com_api.js)"
echo "4. Sistema E-commerce Exemplo (sistema_exemplo.js)"
echo "5. Cliente API - Teste (cliente_api.js test)"
echo "6. Ambiente Completo (Bot API + Sistema Exemplo)"
echo "7. Monitorar Bot (cliente_api.js monitor)"
echo ""

read -p "Digite sua escolha (1-7): " choice

case $choice in
    1)
        echo "▶️ Iniciando Bot Básico..."
        node meu_bot.js
        ;;
    2)
        echo "▶️ Iniciando Bot Avançado..."
        node bot_avancado.js
        ;;
    3)
        echo "▶️ Iniciando Bot com API REST..."
        echo "🌐 API estará disponível em: http://localhost:3001"
        node bot_com_api.js
        ;;
    4)
        echo "▶️ Iniciando Sistema E-commerce Exemplo..."
        echo "🏪 Sistema estará disponível em: http://localhost:3002"
        echo "⚠️ Certifique-se de que o bot_com_api.js está rodando primeiro!"
        node sistema_exemplo.js
        ;;
    5)
        echo "▶️ Testando Cliente API..."
        node cliente_api.js test
        ;;
    6)
        echo "▶️ Iniciando Ambiente Completo..."
        echo "🔧 Este modo inicia o Bot API e Sistema Exemplo simultaneamente"
        echo ""

        # Verificar se tmux está disponível
        if command -v tmux &> /dev/null; then
            echo "📱 Usando tmux para gerenciar múltiplas sessões..."

            # Criar sessão tmux para o bot
            tmux new-session -d -s whatsapp-bot "node bot_com_api.js"
            echo "✅ Bot API iniciado em sessão tmux: whatsapp-bot"

            # Aguardar alguns segundos para o bot inicializar
            sleep 3

            # Criar sessão tmux para o sistema exemplo
            tmux new-session -d -s ecommerce-sistema "node sistema_exemplo.js"
            echo "✅ Sistema E-commerce iniciado em sessão tmux: ecommerce-sistema"

            echo ""
            echo "🎉 Ambiente completo iniciado!"
            echo "📱 Bot API: http://localhost:3001"
            echo "🏪 Sistema E-commerce: http://localhost:3002"
            echo ""
            echo "Para gerenciar as sessões:"
            echo "  tmux list-sessions          # Listar sessões"
            echo "  tmux attach -t whatsapp-bot # Conectar ao bot"
            echo "  tmux attach -t ecommerce-sistema # Conectar ao sistema"
            echo "  tmux kill-session -t whatsapp-bot   # Parar bot"
            echo "  tmux kill-session -t ecommerce-sistema # Parar sistema"

        else
            echo "⚠️ tmux não encontrado. Iniciando apenas o Bot API..."
            echo "💡 Para ambiente completo, instale tmux: brew install tmux (macOS)"
            node bot_com_api.js
        fi
        ;;
    7)
        echo "▶️ Monitorando Bot..."
        echo "📊 Verificando status a cada 5 segundos..."
        echo "🛑 Pressione Ctrl+C para parar"
        node cliente_api.js monitor
        ;;
    *)
        echo "❌ Opção inválida! Use 1-7"
        exit 1
        ;;
esac
