#!/bin/bash

echo "🔄 Reiniciando WhatsApp API com correção do Chrome..."

# Parar container existente
docker stop whatsapp-api-prod 2>/dev/null
docker rm whatsapp-api-prod 2>/dev/null

echo "🧪 Testando diferentes abordagens de Docker..."

# Tentar primeiro com imagem Puppeteer (mais confiável)
echo "📦 Tentativa 1: Usando imagem Puppeteer oficial..."
if docker build -f Dockerfile.puppeteer -t whatsapp-api-puppeteer . 2>/dev/null; then
    echo "✅ Build da imagem Puppeteer bem-sucedido!"

    docker run -d \
      --name whatsapp-api-prod \
      --restart=always \
      -p 3001:3001 \
      -v "$(pwd)":/app \
      -w /app \
      whatsapp-api-puppeteer

    echo "✅ Container criado com imagem Puppeteer!"

else
    echo "❌ Falha na imagem Puppeteer, tentando otimizada..."

    # Se falhar, tentar com nossa imagem otimizada
    echo "📦 Tentativa 2: Usando imagem otimizada..."
    docker build -f Dockerfile.optimized -t whatsapp-api-optimized .

    docker run -d \
      --name whatsapp-api-prod \
      --restart=always \
      -p 3001:3001 \
      -v "$(pwd)":/app \
      -w /app \
      whatsapp-api-optimized

    echo "✅ Container criado com imagem otimizada!"
fi

echo "⏳ Aguardando inicialização (60 segundos)..."
sleep 60

echo "📊 Status do container:"
docker ps | grep whatsapp

echo "📋 Logs recentes:"
docker logs --tail 15 whatsapp-api-prod

echo "🔍 Testando conectividade..."
curl -s http://localhost:3001/status || echo "⚠️ API ainda não está respondendo - normal nos primeiros minutos"

echo "🎬 Testando detecção do Chrome no container..."
docker exec whatsapp-api-prod which google-chrome-stable || echo "Chrome stable não encontrado"
docker exec whatsapp-api-prod which google-chrome || echo "Chrome não encontrado"
docker exec whatsapp-api-prod which chromium-browser || echo "Chromium não encontrado"

echo "✅ Script finalizado!"
echo "📖 Aguarde alguns minutos para a inicialização completa do WhatsApp Web"
