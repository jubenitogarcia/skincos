#!/bin/bash

echo "🔄 Baixando Chromium para Puppeteer..."

# Baixar Chromium via Puppeteer
npm install
npx puppeteer install-chrome

echo "✅ Chromium baixado com sucesso!"

# Verificar se foi instalado
if [ -d "node_modules/puppeteer/.local-chromium" ]; then
    echo "📁 Chromium instalado em: node_modules/puppeteer/.local-chromium"
    ls -la node_modules/puppeteer/.local-chromium/
else
    echo "⚠️ Diretório do Chromium não encontrado"
fi

# Verificar Chrome do sistema
echo "🔍 Verificando Chrome do sistema..."
which google-chrome-stable || echo "Chrome stable não encontrado"
which google-chrome || echo "Chrome não encontrado"
which chromium-browser || echo "Chromium browser não encontrado"

echo "✅ Setup finalizado!"
