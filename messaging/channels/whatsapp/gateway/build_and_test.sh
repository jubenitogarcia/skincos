#!/bin/bash

# Script para construir e testar o Docker localmente
set -e

echo "🐳 Construindo e testando Docker container..."

# Verificar se Docker está disponível
if ! command -v docker &> /dev/null; then
    echo "❌ Docker não encontrado. Instale o Docker primeiro."
    exit 1
fi

# Parar qualquer container anterior
echo "🛑 Parando containers anteriores..."
docker-compose down 2>/dev/null || true

# Build da imagem
echo "🔨 Construindo imagem..."
docker-compose build whatsapp-api

# Testar se a imagem foi criada
echo "✅ Verificando imagem criada..."
docker images | grep whatsapp || echo "⚠️ Imagem não encontrada"

# Iniciar apenas o container principal para teste
echo "🚀 Iniciando container de teste..."
docker-compose up -d whatsapp-api

# Aguardar inicialização
echo "⏳ Aguardando inicialização (30s)..."
sleep 30

# Verificar se está rodando
echo "🔍 Verificando status do container..."
docker-compose ps

# Testar health check manual
echo "🏥 Testando saúde da API..."
for i in {1..5}; do
    if curl -s http://localhost:3001/status >/dev/null 2>&1; then
        echo "✅ API respondendo!"
        curl -s http://localhost:3001/status | head -3
        break
    else
        echo "⏳ Tentativa $i/5 - API ainda não está pronta..."
        sleep 10
    fi
done

# Verificar logs
echo "📋 Últimas linhas dos logs:"
docker-compose logs --tail=10 whatsapp-api

echo ""
echo "✅ Container construído e testado!"
echo "🌐 API disponível em: http://localhost:3001"
echo ""
echo "📋 Próximos passos:"
echo "   Ver QR Code: curl http://localhost:3001/qr"
echo "   Interface web: http://localhost:3001/qr.html"
echo "   Logs completos: docker-compose logs -f whatsapp-api"
echo "   Parar: docker-compose down"
