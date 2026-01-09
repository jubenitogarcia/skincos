#!/bin/bash

# Teste completo da API WhatsApp para Agent-Zero
# Este script simula exatamente o que o Agent-Zero precisa fazer

echo "🤖 TESTE COMPLETO AGENT-ZERO + WHATSAPP API"
echo "============================================="

# 1. Verificar se API está ready
echo "1. 🔍 Verificando se API está pronta..."
HEALTH_CHECK=$(curl -s http://localhost:3001/health)
if echo "$HEALTH_CHECK" | grep -q '"status":"READY"'; then
    echo "   ✅ API está READY para Agent-Zero"
else
    echo "   ❌ API não está ready. Agent-Zero não pode prosseguir."
    exit 1
fi

# 2. Obter status detalhado
echo ""
echo "2. 📊 Obtendo status detalhado..."
STATUS=$(curl -s http://localhost:3001/status)
echo "   📋 Status completo:"
echo "$STATUS" | python3 -m json.tool

# 3. Testar endpoint de chats
echo ""
echo "3. 💬 Testando listagem de chats..."
CHATS=$(curl -s http://localhost:3001/chats)
if echo "$CHATS" | grep -q '"success":true'; then
    echo "   ✅ Chats obtidos com sucesso"
    CHAT_COUNT=$(echo "$CHATS" | python3 -c "import sys, json; data=json.load(sys.stdin); print(data.get('total', 0))")
    echo "   📊 Total de chats: $CHAT_COUNT"
else
    echo "   ⚠️ Erro ao obter chats"
fi

# 4. Teste de envio real (simulação Agent-Zero)
echo ""
echo "4. 📱 TESTE DE ENVIO (simulando Agent-Zero)..."
read -p "   Enviar mensagem de teste? (s/N): " -n 1 -r
echo
if [[ $REPLY =~ ^[Ss]$ ]]; then
    echo "   🚀 Enviando mensagem de teste..."

    SEND_RESULT=$(curl -s -X POST http://localhost:3001/send \
        -H "Content-Type: application/json" \
        -d '{"phone": "+5551995103563", "message": "🤖 Teste Agent-Zero: API funcionando perfeitamente! ✅"}')

    if echo "$SEND_RESULT" | grep -q '"success":true'; then
        echo "   ✅ SUCESSO: Mensagem enviada!"
        echo "   📋 Resposta: $SEND_RESULT"
    else
        echo "   ❌ ERRO no envio:"
        echo "   📋 Resposta: $SEND_RESULT"
    fi
else
    echo "   ⏭️ Teste de envio pulado"
fi

# 5. Verificar logs do sistema
echo ""
echo "5. 📋 Verificando logs do sistema..."
if ls ./logs/*.log 1> /dev/null 2>&1; then
    echo "   📄 Últimas 3 linhas do log mais recente:"
    tail -3 ./logs/*.log | tail -3
else
    echo "   ⚠️ Nenhum log encontrado"
fi

# 6. Resumo final para Agent-Zero
echo ""
echo "🎯 RESUMO FINAL PARA AGENT-ZERO:"
echo "================================="

# Verificar todos os endpoints críticos
ALL_OK=true

# Teste /health
if ! curl -s http://localhost:3001/health | grep -q '"status":"READY"'; then
    ALL_OK=false
fi

# Teste /status
if ! curl -s http://localhost:3001/status | grep -q '"ready":true'; then
    ALL_OK=false
fi

if [ "$ALL_OK" = true ]; then
    echo "✅ SISTEMA 100% OPERACIONAL"
    echo ""
    echo "🤖 Agent-Zero pode usar:"
    echo "   📊 GET  http://localhost:3001/health  → Verificar status"
    echo "   📊 GET  http://localhost:3001/status  → Status detalhado"
    echo "   📱 POST http://localhost:3001/send    → Enviar mensagens"
    echo "   💬 GET  http://localhost:3001/chats   → Listar conversas"
    echo ""
    echo "📝 Exemplo de uso Agent-Zero:"
    echo "   import requests"
    echo "   response = requests.get('http://localhost:3001/health')"
    echo "   if response.json()['status'] == 'READY':"
    echo "       # Enviar mensagem"
    echo "       requests.post('http://localhost:3001/send', json={'phone': '+5551995103563', 'message': 'Teste'})"
    echo ""
    echo "🎉 SISTEMA PRONTO PARA AGENT-ZERO!"
else
    echo "❌ SISTEMA COM PROBLEMAS"
    echo "🔧 Ações necessárias:"
    echo "   - Verificar se bot está rodando"
    echo "   - Reiniciar sistema se necessário"
    echo "   - Verificar logs para erros"
fi
