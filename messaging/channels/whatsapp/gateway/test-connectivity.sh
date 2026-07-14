#!/bin/bash

# 🔧 TESTE DE CONECTIVIDADE COMPLETO
# Verificar todos os endereços de acesso ao WhatsApp Bot

echo "🌐 TESTE COMPLETO DE CONECTIVIDADE - WhatsApp Bot"
echo "================================================"

PORT=3001
LOCAL_IP=$(ipconfig getifaddr en0 2>/dev/null || echo "IP_NAO_ENCONTRADO")

echo ""
echo "📋 CONFIGURAÇÃO DETECTADA:"
echo "  Porta do Bot: $PORT"
echo "  IP Local: $LOCAL_IP"
echo ""

# 1. Teste localhost (macOS host)
echo "🏠 TESTE 1: localhost (macOS host)"
echo "=================================="
if curl -s --connect-timeout 3 http://localhost:$PORT/health >/dev/null 2>&1; then
    echo "✅ http://localhost:$PORT → FUNCIONANDO"
    curl -s http://localhost:$PORT/health | head -1
else
    echo "❌ http://localhost:$PORT → NÃO FUNCIONA"
fi
echo ""

# 2. Teste IP local (macOS host)
echo "📡 TESTE 2: IP local (macOS host)"
echo "================================="
if [ "$LOCAL_IP" != "IP_NAO_ENCONTRADO" ]; then
    if curl -s --connect-timeout 3 http://$LOCAL_IP:$PORT/health >/dev/null 2>&1; then
        echo "✅ http://$LOCAL_IP:$PORT → FUNCIONANDO"
        curl -s http://$LOCAL_IP:$PORT/health | head -1
    else
        echo "❌ http://$LOCAL_IP:$PORT → NÃO FUNCIONA"
    fi
else
    echo "❌ IP local não detectado"
fi
echo ""

# 3. Teste host.docker.internal (macOS host)
echo "🐳 TESTE 3: host.docker.internal (macOS host)"
echo "=============================================="
if curl -s --connect-timeout 3 http://host.docker.internal:$PORT/health >/dev/null 2>&1; then
    echo "✅ http://host.docker.internal:$PORT → FUNCIONANDO"
    curl -s http://host.docker.internal:$PORT/health | head -1
else
    echo "❌ http://host.docker.internal:$PORT → NÃO FUNCIONA (NORMAL no macOS)"
    echo "   💡 host.docker.internal só funciona DENTRO de containers Docker"
fi
echo ""

# 4. Teste host.docker.internal (container Agent-Zero)
echo "🤖 TESTE 4: host.docker.internal (container Agent-Zero)"
echo "======================================================="
if docker ps | grep -q agent-zero; then
    echo "✅ Container agent-zero encontrado"
    if docker exec agent-zero curl -s --connect-timeout 3 http://host.docker.internal:$PORT/health >/dev/null 2>&1; then
        echo "✅ http://host.docker.internal:$PORT → FUNCIONANDO no Agent-Zero"
        docker exec agent-zero curl -s http://host.docker.internal:$PORT/health | head -1
    else
        echo "❌ http://host.docker.internal:$PORT → NÃO FUNCIONA no Agent-Zero"
    fi
else
    echo "⚠️  Container agent-zero não encontrado"
    echo "   Para iniciar: docker run -d --name agent-zero agent0ai/agent-zero"
fi
echo ""

# 5. Teste DNS resolution
echo "🔍 TESTE 5: Resolução DNS"
echo "========================="
echo "📍 localhost:"
if ping -c 1 localhost >/dev/null 2>&1; then
    echo "✅ localhost resolve para: $(ping -c 1 localhost 2>/dev/null | head -1 | grep -o '([^)]*)' | tr -d '()')"
else
    echo "❌ localhost não resolve"
fi

echo "📍 host.docker.internal (macOS):"
if ping -c 1 host.docker.internal >/dev/null 2>&1; then
    echo "✅ host.docker.internal resolve para: $(ping -c 1 host.docker.internal 2>/dev/null | head -1 | grep -o '([^)]*)' | tr -d '()')"
else
    echo "❌ host.docker.internal não resolve (NORMAL no macOS)"
fi

if docker ps | grep -q agent-zero; then
    echo "📍 host.docker.internal (container):"
    DOCKER_INTERNAL_IP=$(docker exec agent-zero getent hosts host.docker.internal 2>/dev/null | awk '{print $1}')
    if [ -n "$DOCKER_INTERNAL_IP" ]; then
        echo "✅ host.docker.internal resolve para: $DOCKER_INTERNAL_IP (no container)"
    else
        echo "❌ host.docker.internal não resolve no container"
    fi
fi
echo ""

# 6. Resumo e recomendações
echo "📊 RESUMO E RECOMENDAÇÕES"
echo "========================="
echo ""
echo "🎯 PARA DESENVOLVIMENTO LOCAL (macOS):"
echo "  ✅ Use: http://localhost:$PORT"
echo "  ✅ Use: http://$LOCAL_IP:$PORT"
echo ""
echo "🎯 PARA AGENT-ZERO (container Docker):"
echo "  ✅ Use: http://host.docker.internal:$PORT"
echo ""
echo "🎯 PARA OUTROS DISPOSITIVOS NA REDE:"
echo "  ✅ Use: http://$LOCAL_IP:$PORT"
echo ""
echo "💡 CONFIGURAÇÃO AGENT-ZERO:"
echo "  WHATSAPP_API_URL = 'http://host.docker.internal:$PORT'"
echo ""
echo "🧪 COMANDOS DE TESTE:"
echo "  # Do macOS:"
echo "  curl http://localhost:$PORT/health"
echo "  # Do Agent-Zero:"
echo "  docker exec agent-zero curl http://host.docker.internal:$PORT/health"
