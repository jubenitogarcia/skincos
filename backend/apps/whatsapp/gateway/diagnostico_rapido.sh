#!/bin/bash

echo "🔍 Diagnóstico Rápido WhatsApp Docker"
echo "==================================="

echo "📦 Containers Docker:"
docker ps -a | grep -E "(whatsapp|traefik|redis|watchtower)"

echo ""
echo "🌐 Portas em uso:"
netstat -an | grep -E ":3001|:8080|:6379|:8000" 2>/dev/null || ss -tlnp | grep -E ":3001|:8080|:6379|:8000" 2>/dev/null || echo "Comando netstat/ss não disponível"

echo ""
echo "🔧 Status Docker Compose:"
docker-compose ps 2>/dev/null || echo "Docker Compose não funcionou"

echo ""
echo "📊 Logs da API (últimas 10 linhas):"
docker-compose logs --tail=10 whatsapp-api 2>/dev/null || echo "Logs não disponíveis"

echo ""
echo "🧪 Teste de conectividade:"
curl -s --connect-timeout 5 http://localhost:3001/health && echo "✅ API respondendo" || echo "❌ API não responde"

echo ""
echo "💾 Espaço em disco:"
df -h / 2>/dev/null || echo "Comando df não disponível"

echo ""
echo "🏗️ Imagens Docker:"
docker images | grep whatsapp

echo ""
echo "📁 Arquivos principais:"
ls -la docker-compose.yml Dockerfile.fast bot_com_api.js 2>/dev/null || echo "Alguns arquivos não encontrados"
