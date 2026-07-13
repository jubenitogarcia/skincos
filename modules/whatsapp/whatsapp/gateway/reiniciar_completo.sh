#!/bin/bash

echo "🔄 Reiniciando WhatsApp API com Docker Compose (porta 3001)..."

# Parar containers existentes
echo "🛑 Parando containers existentes..."
docker-compose down

echo "🧹 Limpando containers antigos..."
docker stop whatsapp-api-prod 2>/dev/null
docker rm whatsapp-api-prod 2>/dev/null

echo "🏗️ Construindo imagem com configuração otimizada..."
docker-compose build whatsapp-api

if [ $? -ne 0 ]; then
    echo "❌ Falha no build da imagem"
    exit 1
fi

echo "📦 Iniciando todos os serviços..."
docker-compose up -d

echo "⏳ Aguardando inicialização (45 segundos)..."
sleep 45

echo "📊 Status dos containers:"
docker-compose ps

echo "📋 Logs recentes da API:"
docker-compose logs --tail 30 whatsapp-api

echo "🔍 Verificando se há erros de Puppeteer..."
if docker-compose logs whatsapp-api | grep -q "libgobject-2.0.so.0"; then
    echo "⚠️ Detectado erro de dependências do Puppeteer!"
    echo "� Reconstruindo imagem com dependências corretas..."
    docker-compose down
    docker-compose build whatsapp-api
    docker-compose up -d
    echo "⏳ Aguardando nova inicialização..."
    sleep 30
fi

echo "🔍 Testando conectividade..."
echo "Nota: Use os comandos PowerShell separadamente no Windows:"
echo "  Invoke-WebRequest -Uri 'http://localhost:3001/health'"
echo "  Invoke-WebRequest -Uri 'http://localhost:3001/status'"
echo "  Invoke-WebRequest -Uri 'http://localhost:8080'"

echo ""
echo "📍 URLs importantes:"
echo "   • API WhatsApp: http://localhost:3001"
echo "   • QR Code: http://localhost:3001/qr"
echo "   • Traefik Dashboard: http://localhost:8080"
echo "   • Redis: localhost:6379"

echo "✅ Script finalizado!"
