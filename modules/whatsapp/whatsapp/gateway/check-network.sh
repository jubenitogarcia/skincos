#!/bin/bash

# 🌐 ENDEREÇOS DE ACESSO - WhatsApp Bot API
# Script para descobrir todos os endereços disponíveis

echo "🌐 ENDEREÇOS DISPONÍVEIS PARA ACESSAR O WHATSAPP BOT"
echo "=================================================="

PORT=3001

echo ""
echo "📋 CONFIGURAÇÃO ATUAL:"
echo "  Porta: $PORT"
echo "  Bind: 0.0.0.0 (aceita conexões de qualquer IP)"
echo ""

# 1. Localhost (sempre funciona)
echo "🏠 LOCALHOST (acesso local):"
echo "  http://localhost:$PORT"
echo "  http://127.0.0.1:$PORT"
echo ""

# 2. Docker (ESSENCIAL para Agent-Zero)
echo "🐳 DOCKER (Agent-Zero em container):"
echo "  ✅ http://host.docker.internal:$PORT"
echo "     (USAR SEMPRE para Agent-Zero rodando em Docker)"
echo ""

# 3. IP da rede local (Wi-Fi/Ethernet)
echo "📡 REDE LOCAL (acesso de outros dispositivos na mesma rede):"

# Tentar diferentes métodos para obter IP local
LOCAL_IP=""

# Método 1: ipconfig (macOS)
if command -v ipconfig >/dev/null 2>&1; then
    LOCAL_IP=$(ipconfig getifaddr en0 2>/dev/null)
    if [ -z "$LOCAL_IP" ]; then
        LOCAL_IP=$(ipconfig getifaddr en1 2>/dev/null)
    fi
fi

# Método 2: ifconfig
if [ -z "$LOCAL_IP" ]; then
    LOCAL_IP=$(ifconfig | grep "inet " | grep -v "127.0.0.1" | head -1 | awk '{print $2}')
fi

# Método 3: route (backup)
if [ -z "$LOCAL_IP" ]; then
    LOCAL_IP=$(route get default | grep interface | awk '{print $2}' | xargs -I {} ipconfig getifaddr {} 2>/dev/null)
fi

if [ -n "$LOCAL_IP" ]; then
    echo "  ✅ http://$LOCAL_IP:$PORT"
    echo "     (use este IP para acessar de outros dispositivos)"
else
    echo "  ❌ Não foi possível detectar IP local automaticamente"
    echo "     Execute: ifconfig | grep 'inet '"
fi

echo ""

# 3. IP Público (se disponível)
echo "🌍 IP PÚBLICO (acesso pela internet):"
echo "  ⚠️  Cuidado: Não recomendado sem configurar firewall/autenticação"

# Tentar obter IP público
PUBLIC_IP=""
if command -v curl >/dev/null 2>&1; then
    PUBLIC_IP=$(curl -s --connect-timeout 5 ifconfig.me 2>/dev/null)
    if [ -z "$PUBLIC_IP" ]; then
        PUBLIC_IP=$(curl -s --connect-timeout 5 ipinfo.io/ip 2>/dev/null)
    fi
fi

if [ -n "$PUBLIC_IP" ] && [ "$PUBLIC_IP" != "$LOCAL_IP" ]; then
    echo "  🌐 http://$PUBLIC_IP:$PORT"
    echo "     (⚠️  Requer configuração do roteador/firewall)"
else
    echo "  ❌ IP público não detectado ou igual ao local"
fi

echo ""

# 4. Verificar se o serviço está rodando
echo "🔍 VERIFICAÇÃO DO SERVIÇO:"

if curl -s http://localhost:$PORT/health >/dev/null 2>&1; then
    echo "  ✅ Bot está rodando e respondendo"

    # Testar IP local se disponível
    if [ -n "$LOCAL_IP" ]; then
        if curl -s http://$LOCAL_IP:$PORT/health >/dev/null 2>&1; then
            echo "  ✅ Acesso pela rede local funcionando"
        else
            echo "  ❌ Acesso pela rede local bloqueado (firewall?)"
        fi
    fi
else
    echo "  ❌ Bot não está rodando"
    echo "     Execute: ./bot-manager.sh start"
fi

echo ""

# 5. Instruções de uso
echo "📱 COMO USAR:"
echo "============"
echo ""
echo "🖥️  MESMO COMPUTADOR:"
echo "  curl http://localhost:$PORT/health"
echo ""
echo "📱 OUTROS DISPOSITIVOS NA MESMA REDE:"
if [ -n "$LOCAL_IP" ]; then
    echo "  curl http://$LOCAL_IP:$PORT/health"
    echo ""
    echo "🔗 EXEMPLO DE USO:"
    echo "  # Enviar mensagem de outro dispositivo"
    echo "  curl -X POST http://$LOCAL_IP:$PORT/send-message \\"
    echo "    -H 'Content-Type: application/json' \\"
    echo "    -d '{\"number\":\"5511999999999\",\"message\":\"Olá!\"}'"
else
    echo "  Execute 'ifconfig' para encontrar seu IP"
fi

echo ""

# 6. Configurações de firewall
echo "🛡️  CONFIGURAÇÕES DE SEGURANÇA:"
echo "==============================="
echo ""
echo "📋 Para permitir acesso de outros dispositivos:"
echo "  1. Firewall do macOS deve permitir conexões na porta $PORT"
echo "  2. Roteador deve permitir tráfego interno"
echo "  3. Para acesso externo: configurar port forwarding no roteador"
echo ""
echo "⚠️  IMPORTANTE:"
echo "  • Acesso local: Seguro"
echo "  • Acesso da rede: Moderadamente seguro"
echo "  • Acesso público: Requer autenticação/HTTPS"

echo ""
echo "🚀 TESTES RÁPIDOS:"
echo "=================="
echo ""
echo "# Testar localhost:"
echo "curl http://localhost:$PORT/health"
echo ""
if [ -n "$LOCAL_IP" ]; then
    echo "# Testar rede local:"
    echo "curl http://$LOCAL_IP:$PORT/health"
    echo ""
fi
echo "# Ver status do bot:"
echo "./bot-manager.sh status"
