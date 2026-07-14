#!/bin/bash

echo "🔧 Configurando Puppeteer e Chromium..."

# Definir variável de ambiente para baixar Chromium
export PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=false

# Limpar cache do npm
echo "🧹 Limpando cache do npm..."
npm cache clean --force

# Reinstalar puppeteer com download do Chromium
echo "📦 Reinstalando Puppeteer com Chromium..."
npm uninstall puppeteer
npm install puppeteer@18.2.1

# Verificar se Chromium foi baixado
echo "🔍 Verificando instalação do Chromium..."
if [ -d "node_modules/puppeteer/.local-chromium" ]; then
    echo "✅ Chromium encontrado em node_modules/puppeteer/.local-chromium"
    ls -la node_modules/puppeteer/.local-chromium/
else
    echo "❌ Chromium não encontrado, tentando download manual..."

    # Tentar download manual do Chromium
    cd node_modules/puppeteer
    npm run install
    cd ../..
fi

# Verificar novamente
if [ -d "node_modules/puppeteer/.local-chromium" ]; then
    echo "✅ Chromium instalado com sucesso!"

    # Mostrar caminho do Chromium
    CHROMIUM_PATH=$(find node_modules/puppeteer/.local-chromium -name "chrome" -type f 2>/dev/null | head -1)
    if [ ! -z "$CHROMIUM_PATH" ]; then
        echo "🎯 Chromium executável em: $CHROMIUM_PATH"
        chmod +x "$CHROMIUM_PATH"
    fi
else
    echo "❌ Falha ao instalar Chromium"
    exit 1
fi

echo "✅ Configuração do Puppeteer concluída!"
