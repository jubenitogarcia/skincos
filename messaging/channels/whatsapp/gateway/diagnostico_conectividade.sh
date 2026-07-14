#!/bin/bash

echo "🔍 DIAGNÓSTICO DE CONECTIVIDADE AGENT-ZERO"
echo "=========================================="

# 1. Verificar se o serviço está rodando localmente
echo "1. 🔧 Testando localhost..."
LOCAL_TEST=$(curl -s -w "%{http_code}" http://localhost:3001/health)
if [[ $LOCAL_TEST == *"200"* ]]; then
    echo "   ✅ localhost:3001 OK"
else
    echo "   ❌ localhost:3001 FALHOU"
    exit 1
fi

# 2. Verificar se o serviço está rodando no IP da rede
echo ""
echo "2. 🌐 Testando IP da rede..."
NETWORK_TEST=$(curl -s -w "%{http_code}" http://192.168.15.14:3001/health)
if [[ $NETWORK_TEST == *"200"* ]]; then
    echo "   ✅ 192.168.15.14:3001 OK"
else
    echo "   ❌ 192.168.15.14:3001 FALHOU"
fi

# 3. Verificar portas abertas
echo ""
echo "3. 🔌 Verificando portas..."
netstat -an | grep ":3001" | head -3

# 4. Verificar interfaces de rede
echo ""
echo "4. 🌍 Interfaces de rede ativas..."
ifconfig | grep -A 1 "inet " | grep -v "127.0.0.1"

# 5. Teste de conectividade externa
echo ""
echo "5. 🌐 Testando se ngrok está ativo..."
NGROK_STATUS=$(curl -s http://localhost:4040/api/tunnels 2>/dev/null)
if [[ -n "$NGROK_STATUS" ]]; then
    echo "   ✅ ngrok está rodando"
    echo "   📋 URLs disponíveis:"
    echo "$NGROK_STATUS" | python3 -c "
import sys, json
try:
    data = json.load(sys.stdin)
    for tunnel in data.get('tunnels', []):
        print(f\"   🔗 {tunnel['public_url']}\")
except:
    print('   ⚠️ Erro ao processar dados do ngrok')
"
else
    echo "   ❌ ngrok não está ativo"
fi

echo ""
echo "🎯 SOLUÇÕES PARA AGENT-ZERO:"
echo "============================"

# Verificar qual solução usar
if curl -s http://localhost:4040/api/tunnels | grep -q "public_url"; then
    echo "✅ USAR NGROK (recomendado)"
    echo "   Agent-Zero deve usar a URL do ngrok acima"
elif curl -s http://192.168.15.14:3001/health | grep -q "READY"; then
    echo "✅ USAR IP DA REDE"
    echo "   Agent-Zero deve usar: http://192.168.15.14:3001"
    echo "   ⚠️  Verificar se Agent-Zero está na mesma rede"
else
    echo "❌ PROBLEMAS DE CONECTIVIDADE"
    echo "   🔧 Soluções:"
    echo "   1. Reiniciar ngrok: pkill ngrok && ngrok http 3001"
    echo "   2. Verificar firewall do macOS"
    echo "   3. Usar túnel alternativo"
fi
