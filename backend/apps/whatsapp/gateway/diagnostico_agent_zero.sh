#!/bin/bash

# Script de diagnóstico para Agent-Zero
# Verifica se todos os endpoints estão funcionando

echo "🔍 DIAGNÓSTICO WHATSAPP API PARA AGENT-ZERO"
echo "============================================"

# Testar conectividade básica
echo "1. 🌐 Testando conectividade básica..."
if curl -s http://localhost:3001 > /dev/null; then
    echo "   ✅ Servidor respondendo na porta 3001"
else
    echo "   ❌ Servidor não responde na porta 3001"
    exit 1
fi

# Testar endpoint /status
echo ""
echo "2. 📊 Testando endpoint /status..."
STATUS_RESPONSE=$(curl -s http://localhost:3001/status)
if [ $? -eq 0 ]; then
    echo "   ✅ Endpoint /status OK"
    echo "   📋 Resposta: $STATUS_RESPONSE"

    # Verificar se está ready
    if echo "$STATUS_RESPONSE" | grep -q '"ready":true'; then
        echo "   ✅ Status: READY"
    else
        echo "   ⚠️ Status: NOT READY"
    fi
else
    echo "   ❌ Endpoint /status falhou"
fi

# Testar endpoint /health
echo ""
echo "3. 🏥 Testando endpoint /health..."
HEALTH_RESPONSE=$(curl -s http://localhost:3001/health)
if [ $? -eq 0 ]; then
    echo "   ✅ Endpoint /health OK"
    echo "   📋 Resposta: $HEALTH_RESPONSE"

    # Verificar se está READY
    if echo "$HEALTH_RESPONSE" | grep -q '"status":"READY"'; then
        echo "   ✅ Health: READY"
    else
        echo "   ⚠️ Health: NOT_READY"
    fi
else
    echo "   ❌ Endpoint /health falhou"
fi

# Testar jq (se disponível)
echo ""
echo "4. 🔧 Verificando ferramentas..."
if command -v jq &> /dev/null; then
    echo "   ✅ jq disponível"
    echo "   📊 Status formatado:"
    curl -s http://localhost:3001/status | jq .
else
    echo "   ⚠️ jq não disponível (use python3 -m json.tool como alternativa)"
    echo "   📊 Status formatado com Python:"
    curl -s http://localhost:3001/status | python3 -m json.tool
fi

# Teste de envio (simulado)
echo ""
echo "5. 📱 Teste de envio (apenas estrutura)..."
TEST_PAYLOAD='{"phone": "+5551995103563", "message": "Teste de diagnóstico"}'
echo "   📋 Payload de teste: $TEST_PAYLOAD"
echo "   💡 Para testar envio real, execute:"
echo "      curl -X POST http://localhost:3001/send \\"
echo "        -H \"Content-Type: application/json\" \\"
echo "        -d '$TEST_PAYLOAD'"

echo ""
echo "🎯 RESUMO PARA AGENT-ZERO:"
echo "=========================="

# Status final
if curl -s http://localhost:3001/status | grep -q '"ready":true' && \
   curl -s http://localhost:3001/health | grep -q '"status":"READY"'; then
    echo "✅ API FUNCIONANDO - Agent-Zero pode prosseguir"
    echo "📊 Endpoints disponíveis:"
    echo "   - GET  http://localhost:3001/status"
    echo "   - GET  http://localhost:3001/health"
    echo "   - POST http://localhost:3001/send"
    echo "   - GET  http://localhost:3001/chats"
else
    echo "❌ API NÃO ESTÁ PRONTA - Verificar logs"
    echo "🔧 Ações sugeridas:"
    echo "   - Verificar se bot está rodando: ps aux | grep bot"
    echo "   - Reiniciar: ./iniciar_background.sh"
    echo "   - Ver logs: tail -f ./logs/*.log"
fi
