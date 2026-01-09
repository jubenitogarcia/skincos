#!/bin/bash

echo "🛑 PARANDO TODAS AS SESSÕES DO WHATSAPP BOT"
echo "========================================="

echo ""
echo "🔍 Verificando processos ativos..."

# Encontrar todos os processos relacionados ao bot
BOT_PROCESSES=$(ps aux | grep -E "(node.*bot|whatsapp)" | grep -v grep | grep -v "Code Helper")

if [ -z "$BOT_PROCESSES" ]; then
    echo "ℹ️ Nenhum processo do bot encontrado rodando"
else
    echo "📋 Processos encontrados:"
    echo "$BOT_PROCESSES"
    echo ""

    echo "🛑 Parando processos do bot..."

    # Parar processos específicos do bot
    pkill -f "node.*bot_estavel_macos.js"
    pkill -f "node.*bot_headless.js"
    pkill -f "node.*bot_production.js"

    sleep 2

    # Verificar se ainda há processos rodando
    REMAINING=$(ps aux | grep -E "(node.*bot|whatsapp)" | grep -v grep | grep -v "Code Helper")

    if [ -z "$REMAINING" ]; then
        echo "✅ Todos os processos do bot foram parados"
    else
        echo "⚠️ Alguns processos ainda estão rodando:"
        echo "$REMAINING"
        echo ""
        read -p "Forçar parada? (s/N): " -n 1 -r
        echo
        if [[ $REPLY =~ ^[Ss]$ ]]; then
            echo "💀 Forçando parada..."
            pkill -9 -f "node.*bot"
            echo "✅ Parada forçada concluída"
        fi
    fi
fi

echo ""
echo "🧹 Limpando recursos..."

# Parar túneis se houver
echo "🔌 Parando túneis..."
pkill -f "localtunnel" 2>/dev/null
pkill -f "ngrok" 2>/dev/null
pkill -f "cloudflared" 2>/dev/null

# Limpar sessões antigas do Chrome
echo "🌐 Limpando sessões do Chrome..."
if [ -d ".wwebjs_auth" ]; then
    echo "📁 Encontrada pasta de autenticação: .wwebjs_auth"
    read -p "Limpar sessão salva? (s/N): " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Ss]$ ]]; then
        rm -rf .wwebjs_auth
        echo "🗑️ Sessão de autenticação removida"
    else
        echo "💾 Sessão de autenticação mantida"
    fi
fi

if [ -d ".wwebjs_cache" ]; then
    echo "🗑️ Limpando cache..."
    rm -rf .wwebjs_cache
    echo "✅ Cache limpo"
fi

# Verificar portas
echo ""
echo "🔌 Verificando porta 3001..."
PORT_CHECK=$(lsof -ti:3001)
if [ -n "$PORT_CHECK" ]; then
    echo "⚠️ Porta 3001 ainda em uso pelo processo: $PORT_CHECK"
    read -p "Liberar porta 3001? (s/N): " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Ss]$ ]]; then
        kill -9 $PORT_CHECK
        echo "✅ Porta 3001 liberada"
    fi
else
    echo "✅ Porta 3001 está livre"
fi

echo ""
echo "🎯 LIMPEZA CONCLUÍDA!"
echo ""
echo "📋 O que foi feito:"
echo "- ✅ Processos do bot parados"
echo "- ✅ Túneis fechados"
echo "- ✅ Cache limpo"
echo "- ✅ Porta liberada"
echo ""
echo "🚀 Agora você pode iniciar uma nova sessão com:"
echo "./iniciar_bot.sh"
