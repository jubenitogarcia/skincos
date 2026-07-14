#!/bin/bash

echo "🔧 Instalando Cloudflared..."

# Verificar arquitetura do Mac
if [[ $(uname -m) == "arm64" ]]; then
    ARCH="arm64"
else
    ARCH="amd64"
fi

echo "🖥️ Arquitetura detectada: $ARCH"

# Baixar cloudflared
echo "📥 Baixando cloudflared..."
curl -L -o cloudflared "https://github.com/cloudflare/cloudflared/releases/download/2024.10.0/cloudflared-darwin-${ARCH}"

# Verificar se o download foi bem-sucedido
if [ ! -f "cloudflared" ] || [ ! -s "cloudflared" ]; then
    echo "❌ Erro no download. Tentando versão alternativa..."
    curl -L -o cloudflared "https://github.com/cloudflare/cloudflared/releases/download/2024.9.1/cloudflared-darwin-${ARCH}"
fi

# Verificar novamente
if [ ! -f "cloudflared" ] || [ ! -s "cloudflared" ]; then
    echo "❌ Falha no download. Vamos tentar uma abordagem diferente."
    exit 1
fi

# Tornar executável
chmod +x cloudflared

# Verificar se funciona
echo "🧪 Testando cloudflared..."
./cloudflared --version

echo "✅ Cloudflared instalado com sucesso!"
echo "📍 Localização: $(pwd)/cloudflared"
