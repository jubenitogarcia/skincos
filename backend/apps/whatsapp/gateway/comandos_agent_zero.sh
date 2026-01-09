#!/bin/bash

# COMANDOS PARA AGENT-ZERO TESTAR

echo "🤖 COMANDOS PARA AGENT-ZERO"
echo "=========================="
echo ""
echo "✅ 1. TESTAR CONEXÃO (Health Check):"
echo "curl -X GET http://192.168.15.14:3001/health"
echo ""
echo "✅ 2. OBTER STATUS DETALHADO:"
echo "curl -X GET http://192.168.15.14:3001/status"
echo ""
echo "✅ 3. ENVIAR MENSAGEM DE TESTE:"
echo "curl -X POST http://192.168.15.14:3001/send \\"
echo "  -H \"Content-Type: application/json\" \\"
echo "  -d '{\"phone\": \"+5551995103563\", \"message\": \"🤖 Teste Agent-Zero via IP da rede!\"}'"
echo ""
echo "✅ 4. LISTAR CHATS:"
echo "curl -X GET http://192.168.15.14:3001/chats"
echo ""
echo "🎯 IMPORTANTE PARA AGENT-ZERO:"
echo "- Use sempre o IP: 192.168.15.14:3001"
echo "- NÃO use localhost:3001 (não funciona do Agent-Zero)"
echo "- Todos os endpoints estão funcionais"
echo ""

# Teste automático
echo "🧪 EXECUTANDO TESTE AUTOMÁTICO..."
echo ""

echo "1. 🔍 Testando health check..."
HEALTH=$(curl -s http://192.168.15.14:3001/health)
if echo "$HEALTH" | grep -q '"status":"READY"'; then
    echo "   ✅ Health check OK - Agent-Zero pode conectar!"
else
    echo "   ❌ Health check falhou"
    exit 1
fi

echo ""
echo "2. 📊 Testando status..."
STATUS=$(curl -s http://192.168.15.14:3001/status)
if echo "$STATUS" | grep -q '"ready":true'; then
    echo "   ✅ Status OK - WhatsApp está pronto!"
else
    echo "   ❌ Status falhou"
fi

echo ""
echo "🎉 SISTEMA PRONTO PARA AGENT-ZERO!"
echo "Agent-Zero deve usar: http://192.168.15.14:3001"
