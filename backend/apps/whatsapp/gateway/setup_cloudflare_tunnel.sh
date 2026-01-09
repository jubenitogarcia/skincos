#!/bin/bash

echo "🌐 Configurador Cloudflare Tunnel - WhatsApp API"
echo "================================================"
echo ""

# Verificar se cloudflared está instalado
if ! command -v cloudflared &> /dev/null; then
    echo "❌ cloudflared não encontrado!"
    echo ""
    echo "📥 Duas opções de instalação:"
    echo ""
    echo "OPÇÃO 1 - Homebrew:"
    echo "brew install cloudflare/cloudflare/cloudflared"
    echo ""
    echo "OPÇÃO 2 - Download direto:"
    echo "curl -L -o cloudflared https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-darwin-arm64"
    echo "chmod +x cloudflared"
    echo "sudo mv cloudflared /usr/local/bin/"
    echo ""
    echo "Execute uma das opções acima e rode este script novamente."
    exit 1
fi

echo "✅ cloudflared encontrado: $(cloudflared --version | head -1)"
echo ""

# Verificar se WhatsApp API está rodando
echo "🔍 Verificando WhatsApp API..."
if curl -s http://localhost:3001/status > /dev/null; then
    echo "✅ WhatsApp API está rodando na porta 3001"
else
    echo "❌ WhatsApp API não está rodando!"
    echo "   Execute primeiro: node bot_com_api.js"
    echo ""
    exit 1
fi

echo ""
echo "🚀 CONFIGURAÇÃO DO TÚNEL"
echo "========================"
echo ""

# Etapa 1: Login
echo "🔐 1. Autenticação com Cloudflare"
echo "Execute o comando abaixo e faça login no navegador:"
echo ""
echo "cloudflared tunnel login"
echo ""
read -p "Pressione Enter após fazer o login..."

# Etapa 2: Criar túnel
echo ""
echo "🚀 2. Criando túnel"
TUNNEL_NAME="whatsapp-api-tunnel"
echo "Executando: cloudflared tunnel create $TUNNEL_NAME"

# Etapa 3: Configuração
echo ""
echo "⚙️ 3. Criando configuração"
mkdir -p ~/.cloudflared

cat > ~/.cloudflared/config.yml << EOF
tunnel: $TUNNEL_NAME
credentials-file: ~/.cloudflared/$TUNNEL_NAME.json

ingress:
  - hostname: api.skincos.com.br
    service: http://localhost:3001
  - service: http_status:404
EOF

echo "✅ Arquivo de configuração criado!"

# Instruções finais
echo ""
echo "🌍 4. CONFIGURAÇÃO DNS NO CLOUDFLARE"
echo "===================================="
echo "1. Acesse: https://dash.cloudflare.com"
echo "2. Selecione: skincos.com.br"
echo "3. Vá em: DNS > Records"
echo "4. Adicione registro CNAME:"
echo "   - Nome: api"
echo "   - Destino: (será mostrado ao rodar o túnel)"
echo ""

echo "🎯 5. INICIAR TÚNEL"
echo "=================="
echo "Execute:"
echo "cloudflared tunnel run $TUNNEL_NAME"
echo ""
echo "🌐 Sua API estará em: https://api.skincos.com.br/status"
if curl -s http://localhost:3001/health | grep -q '"status":"READY"'; then
    echo "✅ API WhatsApp está rodando e pronta"
    echo ""
    echo "🎯 APÓS CONFIGURAR O TUNNEL:"
    echo "Sua API estará disponível em:"
    echo "https://whatsapp-api-SEU-ID.trycloudflare.com"
    echo ""
    echo "🤖 Agent-Zero poderá usar:"
    echo "curl -X GET https://whatsapp-api-SEU-ID.trycloudflare.com/health"
    echo "curl -X POST https://whatsapp-api-SEU-ID.trycloudflare.com/send"
else
    echo "❌ API WhatsApp não está rodando!"
    echo "Execute primeiro: node bot_estavel_macos.js"
fi

echo ""
echo "📚 DOCUMENTAÇÃO COMPLETA:"
echo "https://developers.cloudflare.com/cloudflare-one/connections/connect-apps/install-and-setup/tunnel-guide/"
