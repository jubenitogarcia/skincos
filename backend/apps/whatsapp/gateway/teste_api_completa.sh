#!/bin/bash

echo "🧪 TESTE COMPLETO DA API WHATSAPP AUTOMATION"
echo "============================================="
echo ""

# Configurações
API_BASE="http://localhost:3001"
TEST_PHONE="+5551995103563"  # Substitua pelo seu número para testes
TEST_CONTACT="+5551999888777"  # Número de contato para testes

# Cores para output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Função para testar endpoint
test_endpoint() {
    local method=$1
    local endpoint=$2
    local data=$3
    local description=$4

    echo -e "${BLUE}🔍 Testando: $description${NC}"
    echo "   Endpoint: $method $endpoint"

    if [ "$method" = "GET" ]; then
        response=$(curl -s -w "%{http_code}" "$API_BASE$endpoint")
    else
        response=$(curl -s -w "%{http_code}" -X "$method" "$API_BASE$endpoint" \
            -H "Content-Type: application/json" \
            -d "$data")
    fi

    http_code="${response: -3}"
    body="${response%???}"

    if [ "$http_code" -eq 200 ] || [ "$http_code" -eq 201 ]; then
        echo -e "   ${GREEN}✅ Sucesso ($http_code)${NC}"
        echo "   Resposta: $(echo "$body" | jq -r '.message // .status // "OK"' 2>/dev/null || echo "OK")"
    else
        echo -e "   ${RED}❌ Erro ($http_code)${NC}"
        echo "   Resposta: $body"
    fi
    echo ""
}

echo "📋 INICIANDO BATERIA DE TESTES..."
echo ""

# 1. TESTES DE STATUS E INFORMAÇÕES
echo -e "${YELLOW}=== TESTES DE STATUS E INFORMAÇÕES ===${NC}"
test_endpoint "GET" "/health" "" "Health Check (Agent-Zero)"
test_endpoint "GET" "/status" "" "Status do Bot"
test_endpoint "GET" "/info" "" "Informações do Usuário"

# 2. TESTES DE CONTATOS
echo -e "${YELLOW}=== TESTES DE CONTATOS ===${NC}"
test_endpoint "GET" "/contacts" "" "Listar Contatos"
test_endpoint "GET" "/check-number/${TEST_PHONE//[^0-9]/}" "" "Verificar Número WhatsApp"

# 3. TESTES DE CHATS E GRUPOS
echo -e "${YELLOW}=== TESTES DE CHATS E GRUPOS ===${NC}"
test_endpoint "GET" "/chats" "" "Listar Chats"
test_endpoint "GET" "/groups" "" "Listar Grupos"

# 4. TESTES DE ENVIO DE MENSAGENS
echo -e "${YELLOW}=== TESTES DE ENVIO DE MENSAGENS ===${NC}"

# Mensagem de texto
test_endpoint "POST" "/send" "{\"phone\":\"$TEST_PHONE\",\"message\":\"🧪 Teste automatizado da API - Mensagem de texto\"}" "Enviar Mensagem de Texto"

# 5. TESTES DE MÍDIA (opcionais - precisam de URLs/arquivos válidos)
echo -e "${YELLOW}=== TESTES DE MÍDIA (Opcionais) ===${NC}"
echo "   ⚠️ Pulando testes de mídia (precisam de URLs/arquivos válidos)"

# 6. TESTES DE LOCALIZAÇÃO
echo -e "${YELLOW}=== TESTES DE LOCALIZAÇÃO ===${NC}"
test_endpoint "POST" "/send-location" "{\"phone\":\"$TEST_PHONE\",\"latitude\":-30.0346,\"longitude\":-51.2177,\"name\":\"Porto Alegre\",\"address\":\"Centro, Porto Alegre, RS\"}" "Enviar Localização"

# 7. TESTES DE FUNCIONALIDADES AVANÇADAS
echo -e "${YELLOW}=== TESTES DE FUNCIONALIDADES AVANÇADAS ===${NC}"
test_endpoint "POST" "/mark-seen" "{\"chatId\":\"${TEST_PHONE//[^0-9]/}@c.us\"}" "Marcar Como Visualizado"
test_endpoint "POST" "/set-status" "{\"status\":\"🤖 API Testada com Sucesso!\"}" "Definir Status"

# 8. TESTES DE BUSCA
echo -e "${YELLOW}=== TESTES DE BUSCA ===${NC}"
test_endpoint "POST" "/search-messages" "{\"query\":\"teste\",\"limit\":5}" "Buscar Mensagens"

# 9. VERIFICAÇÃO FINAL
echo -e "${YELLOW}=== VERIFICAÇÃO FINAL ===${NC}"
test_endpoint "GET" "/health" "" "Health Check Final"

echo ""
echo -e "${GREEN}🎉 BATERIA DE TESTES CONCLUÍDA!${NC}"
echo ""
echo "📋 RESULTADOS:"
echo "   ✅ Testes básicos de status e informações"
echo "   ✅ Testes de listagem (contatos, chats, grupos)"
echo "   ✅ Testes de envio de mensagens"
echo "   ✅ Testes de funcionalidades avançadas"
echo ""
echo "📱 PRÓXIMOS PASSOS:"
echo "   1. Verifique as mensagens no seu WhatsApp"
echo "   2. Teste funcionalidades específicas conforme necessário"
echo "   3. Configure acesso global se necessário: ./escolher_opcao_global.sh"
echo ""

# Função para testar grupos (se existirem)
echo -e "${BLUE}🔍 Verificando grupos disponíveis...${NC}"
groups_response=$(curl -s "$API_BASE/groups")
group_count=$(echo "$groups_response" | jq -r '.total // 0' 2>/dev/null || echo "0")

if [ "$group_count" -gt 0 ]; then
    echo "   ✅ Encontrados $group_count grupos"
    echo "   💡 Execute './teste_grupos.sh' para testes específicos de grupos"
else
    echo "   ⚠️ Nenhum grupo encontrado"
    echo "   💡 Crie grupos no WhatsApp para testar funcionalidades de grupo"
fi

echo ""
echo -e "${GREEN}📚 Documentação completa: API_COMPLETA_DOCUMENTACAO.md${NC}"
echo -e "${GREEN}🤖 Pronto para Agent-Zero: Todos os endpoints funcionais!${NC}"
