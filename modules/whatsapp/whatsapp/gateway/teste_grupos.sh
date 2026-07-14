#!/bin/bash

echo "🔍 TESTE DE GRUPOS WHATSAPP - AGENT-ZERO"
echo "======================================="

# Verificar se API está rodando
echo "1. 🔍 Verificando se API está ativa..."
if ! curl -s http://localhost:3001/health | grep -q '"status":"READY"'; then
    echo "❌ API não está rodando ou não está pronta"
    echo "Execute primeiro: ./iniciar_bot.sh"
    exit 1
fi
echo "✅ API está ativa"

echo ""
echo "2. 📋 Listando grupos disponíveis..."

# Listar grupos
GROUPS_RESPONSE=$(curl -s http://localhost:3001/groups)

if echo "$GROUPS_RESPONSE" | grep -q '"success":true'; then
    echo "✅ Grupos encontrados:"
    echo "$GROUPS_RESPONSE" | python3 -c "
import sys, json
try:
    data = json.load(sys.stdin)
    groups = data.get('groups', [])
    if groups:
        for i, group in enumerate(groups[:5]):  # Mostrar apenas 5 primeiros
            print(f'   {i+1}. {group[\"name\"]} (ID: {group[\"id\"]})')
            print(f'      Participantes: {group.get(\"participantCount\", \"N/A\")}')
            print()
    else:
        print('   ⚠️ Nenhum grupo encontrado')
except Exception as e:
    print(f'   ❌ Erro ao processar grupos: {e}')
"
else
    echo "❌ Erro ao listar grupos:"
    echo "$GROUPS_RESPONSE"
    exit 1
fi

echo ""
echo "3. 🧪 TESTE DE ENVIO PARA GRUPO"
echo ""

# Extrair primeiro grupo para teste
FIRST_GROUP_ID=$(echo "$GROUPS_RESPONSE" | python3 -c "
import sys, json
try:
    data = json.load(sys.stdin)
    groups = data.get('groups', [])
    if groups:
        print(groups[0]['id'])
    else:
        print('')
except:
    print('')
")

if [ -z "$FIRST_GROUP_ID" ]; then
    echo "❌ Nenhum grupo disponível para teste"
    exit 1
fi

FIRST_GROUP_NAME=$(echo "$GROUPS_RESPONSE" | python3 -c "
import sys, json
try:
    data = json.load(sys.stdin)
    groups = data.get('groups', [])
    if groups:
        print(groups[0]['name'])
    else:
        print('Grupo sem nome')
except:
    print('Grupo sem nome')
")

echo "🎯 Testando envio para: $FIRST_GROUP_NAME"
echo "📋 ID do grupo: $FIRST_GROUP_ID"
echo ""

# Mensagem de teste
TEST_MESSAGE="🤖 Teste Agent-Zero: Envio para grupo funcionando! ✅ $(date +%H:%M:%S)"

echo "📱 Enviando mensagem de teste..."
SEND_RESPONSE=$(curl -s -X POST http://localhost:3001/send \
    -H "Content-Type: application/json" \
    -d "{\"groupId\": \"$FIRST_GROUP_ID\", \"message\": \"$TEST_MESSAGE\"}")

echo ""
echo "📋 Resposta da API:"
echo "$SEND_RESPONSE" | python3 -m json.tool 2>/dev/null || echo "$SEND_RESPONSE"

echo ""
if echo "$SEND_RESPONSE" | grep -q '"success":true'; then
    echo "✅ API reportou SUCESSO!"
    echo ""
    echo "🤖 COMANDOS PARA AGENT-ZERO:"
    echo "=============================="
    echo ""
    echo "1. Listar grupos:"
    echo "curl -X GET http://localhost:3001/groups"
    echo ""
    echo "2. Enviar para grupo específico:"
    echo "curl -X POST http://localhost:3001/send \\"
    echo "  -H \"Content-Type: application/json\" \\"
    echo "  -d '{\"groupId\": \"$FIRST_GROUP_ID\", \"message\": \"Sua mensagem aqui\"}'"
    echo ""
    echo "🎯 IMPORTANTE:"
    echo "- Use 'groupId' para grupos, não 'phone'"
    echo "- O ID do grupo deve incluir '@g.us' no final"
    echo "- Verifique se o bot está no grupo antes de enviar"
    echo ""
    echo "⚠️ SE A MENSAGEM NÃO CHEGOU:"
    echo "1. Verificar se bot está no grupo"
    echo "2. Verificar permissões do grupo"
    echo "3. Tentar reautenticar o WhatsApp Web"
else
    echo "❌ ERRO no envio:"
    echo "$SEND_RESPONSE"
fi

echo ""
echo "📚 DOCUMENTAÇÃO ADICIONAL:"
echo "- Endpoint /groups: Lista todos os grupos"
echo "- Endpoint /chats: Lista chats e grupos"
echo "- Endpoint /send: Envia para phone (individual) ou groupId (grupo)"
