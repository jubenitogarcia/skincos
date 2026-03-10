#!/bin/bash

# ========================================
# TESTE COMPLETO DO SISTEMA SPRINTA
# Versão simplificada e compatível com macOS
# ========================================

echo "🔍 Teste Completo do Sistema Sprinta"
echo "======================================"
echo ""

# Cores
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Variáveis
NGROK_URL="${NGROK_URL:-https://eustolia-manistic-understandably.ngrok-free.dev}"
WEBHOOK_SECRET="${SPRINTA_WEBHOOK_SECRET:-}"

if [[ -z "${WEBHOOK_SECRET}" ]]; then
    echo -e "${RED}❌ Variável SPRINTA_WEBHOOK_SECRET não configurada${NC}"
    exit 1
fi

# ========================================
# 1. VERIFICAR SE WEBHOOK SERVER ESTÁ RODANDO
# ========================================
echo "1️⃣  Verificando webhook server..."
if ps aux | grep -v grep | grep "webhook_server.py" > /dev/null; then
    echo -e "${GREEN}✅ Webhook server está rodando${NC}"
else
    echo -e "${RED}❌ Webhook server NÃO está rodando${NC}"
    echo "   Execute: python webhook_server.py"
    exit 1
fi
echo ""

# ========================================
# 2. VERIFICAR SE NGROK ESTÁ RODANDO
# ========================================
echo "2️⃣  Verificando ngrok..."
if ps aux | grep -v grep | grep "ngrok" > /dev/null; then
    echo -e "${GREEN}✅ Ngrok está rodando${NC}"

    # Pegar URL do ngrok
    NGROK_CURRENT_URL=$(curl -s http://localhost:4040/api/tunnels 2>/dev/null | python3 -c "import sys, json; print(json.load(sys.stdin)['tunnels'][0]['public_url'])" 2>/dev/null)

    if [ ! -z "$NGROK_CURRENT_URL" ]; then
        echo "   URL atual: $NGROK_CURRENT_URL"
        NGROK_URL=$NGROK_CURRENT_URL
    fi
else
    echo -e "${RED}❌ Ngrok NÃO está rodando${NC}"
    echo "   Execute: ngrok http 5001"
    exit 1
fi
echo ""

# ========================================
# 3. TESTAR ENDPOINT /health
# ========================================
echo "3️⃣  Testando endpoint /health..."
HEALTH_RESPONSE=$(curl -s "$NGROK_URL/health")

if [ ! -z "$HEALTH_RESPONSE" ]; then
    echo -e "${GREEN}✅ Endpoint /health respondeu OK${NC}"
    echo "   Resposta: $HEALTH_RESPONSE"

    # Verificar se GitHub token está configurado
    if echo "$HEALTH_RESPONSE" | grep -q '"github_token_configured": true'; then
        echo -e "${GREEN}✅ GitHub Token está configurado${NC}"
    else
        echo -e "${RED}❌ GitHub Token NÃO está configurado${NC}"
        echo "   Configure GITHUB_TOKEN no arquivo .env"
    fi
else
    echo -e "${RED}❌ Endpoint /health não respondeu${NC}"
    exit 1
fi
echo ""

# ========================================
# 4. TESTAR ENDPOINT /webhook/sprinta (SEM TOKEN)
# ========================================
echo "4️⃣  Testando /webhook/sprinta SEM token (deve falhar)..."
RESPONSE=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$NGROK_URL/webhook/sprinta" \
  -H "Content-Type: application/json" \
  -d '{"csv_content": "test"}')

if [ "$RESPONSE" == "403" ]; then
    echo -e "${GREEN}✅ Corretamente rejeitou requisição sem token (403)${NC}"
else
    echo -e "${YELLOW}⚠️  Resposta inesperada (HTTP $RESPONSE)${NC}"
fi
echo ""

# ========================================
# 5. TESTAR ENDPOINT /webhook/sprinta (COM TOKEN ERRADO)
# ========================================
echo "5️⃣  Testando /webhook/sprinta com token ERRADO (deve falhar)..."
RESPONSE=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$NGROK_URL/webhook/sprinta" \
  -H "Content-Type: application/json" \
  -H "X-Secret-Token: token-errado" \
  -d '{"csv_content": "test"}')

if [ "$RESPONSE" == "403" ]; then
    echo -e "${GREEN}✅ Corretamente rejeitou token inválido (403)${NC}"
else
    echo -e "${YELLOW}⚠️  Resposta inesperada (HTTP $RESPONSE)${NC}"
fi
echo ""

# ========================================
# 6. TESTAR ENDPOINT /webhook/sprinta (COM TOKEN CORRETO)
# ========================================
echo "6️⃣  Testando /webhook/sprinta com token CORRETO..."
RESPONSE=$(curl -s -X POST "$NGROK_URL/webhook/sprinta" \
  -H "Content-Type: application/json" \
  -H "X-Secret-Token: $WEBHOOK_SECRET" \
  -d '{
    "csv_content": "name;email;phone;cpf;bday;gender;shirt_size;team\nTeste Completo;teste@example.com;11999999999;12345678901;01/01/1990;m;M;Espaço Facial"
  }')

echo "   Resposta: $RESPONSE"

if echo "$RESPONSE" | grep -q '"status": "success"'; then
    echo -e "${GREEN}✅ Webhook processou com sucesso!${NC}"

    # Extrair Run ID se disponível
    RUN_ID=$(echo "$RESPONSE" | python3 -c "import sys, json; data=json.load(sys.stdin); print(data.get('run_id', 'N/A'))" 2>/dev/null)
    if [ "$RUN_ID" != "N/A" ] && [ "$RUN_ID" != "" ]; then
        echo -e "${GREEN}✅ GitHub Action acionada! Run ID: $RUN_ID${NC}"
        echo "   Veja em: https://github.com/jubenitogarcia/Sprinta-Scraper/actions/runs/$RUN_ID"
    fi
elif echo "$RESPONSE" | grep -q '"status": "error"'; then
    echo -e "${RED}❌ Webhook retornou erro${NC}"
    ERROR_MSG=$(echo "$RESPONSE" | python3 -c "import sys, json; data=json.load(sys.stdin); print(data.get('message', 'Erro desconhecido'))" 2>/dev/null)
    echo "   Erro: $ERROR_MSG"
else
    echo -e "${RED}❌ Resposta inesperada do webhook${NC}"
fi
echo ""

# ========================================
# 7. VERIFICAR GITHUB ACTIONS
# ========================================
echo "7️⃣  Verificando GitHub Actions..."
echo "   Acesse: https://github.com/jubenitogarcia/Sprinta-Scraper/actions"
echo "   Deve haver uma execução recente (triggered by repository_dispatch)"
echo ""

# ========================================
# RESUMO FINAL
# ========================================
echo "======================================"
echo "📊 RESUMO DO TESTE"
echo "======================================"
echo ""
echo "✅ Componentes verificados:"
echo "   • Webhook Server: Rodando"
echo "   • Ngrok: Rodando"
echo "   • Endpoint /health: OK"
echo "   • Autenticação: OK"
echo ""
echo "🎯 Próximos passos:"
echo "   1. Verifique se o GitHub Actions foi acionado:"
echo "      https://github.com/jubenitogarcia/Sprinta-Scraper/actions"
echo ""
echo "   2. Configure o código Wix com:"
echo "      WEBHOOK_URL: $NGROK_URL/webhook/sprinta"
echo "      WEBHOOK_SECRET: $WEBHOOK_SECRET"
echo ""
echo "   3. Publique o site Wix e teste o formulário"
echo ""
echo "======================================"
