#!/bin/bash

# Script de teste rápido da infraestrutura
echo "🔍 Teste Rápido da Infraestrutura WhatsApp"
echo "========================================"

# Teste 1: Verificar se containers estão rodando
echo "📦 Containers ativos:"
docker ps --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"

echo ""
echo "🌐 Testes de Conectividade:"

# Teste 2: API WhatsApp
echo -n "API WhatsApp (localhost:3000): "
if curl -s -f http://localhost:3000/health > /dev/null 2>&1; then
    echo "✅ OK"
else
    echo "❌ FALHOU"
fi

# Teste 3: Traefik Dashboard
echo -n "Traefik Dashboard (localhost:8080): "
if curl -s -f http://localhost:8080 > /dev/null 2>&1; then
    echo "✅ OK"
else
    echo "❌ FALHOU"
fi

# Teste 4: Redis
echo -n "Redis (localhost:6379): "
if docker exec redis-whatsapp redis-cli ping > /dev/null 2>&1; then
    echo "✅ OK"
else
    echo "❌ FALHOU"
fi

echo ""
echo "📊 Resumo dos Serviços:"
echo "- API WhatsApp: http://localhost:3000"
echo "- Traefik Dashboard: http://localhost:8080"
echo "- Redis: localhost:6379"

echo ""
echo "🔧 Para ver logs detalhados:"
echo "  docker-compose logs -f [serviço]"
echo ""
echo "🚨 Para reiniciar:"
echo "  docker-compose restart [serviço]"
