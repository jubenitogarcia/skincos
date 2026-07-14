#!/bin/bash

# Script para monitoramento da infraestrutura
set -e

echo "📊 Monitoramento da Infraestrutura WhatsApp"
echo "=========================================="

# Função para verificar status de um serviço
check_service() {
    local service=$1
    local url=$2

    echo -n "🔍 Verificando $service... "

    if docker-compose ps | grep -q "$service.*Up"; then
        echo "✅ Container rodando"

        if [ ! -z "$url" ]; then
            if curl -s -f "$url" > /dev/null 2>&1; then
                echo "   ✅ HTTP respondendo"
            else
                echo "   ❌ HTTP não responde"
            fi
        fi
    else
        echo "❌ Container parado"
    fi
}

# Verificar Docker
echo "🐳 Verificando Docker..."
if ! docker info > /dev/null 2>&1; then
    echo "❌ Docker não está rodando"
    exit 1
fi
echo "✅ Docker ativo"

# Verificar cada serviço
echo ""
echo "🔧 Status dos Serviços:"
check_service "whatsapp-api" "http://localhost:3000/health"
check_service "traefik" "http://localhost:8080"
check_service "watchtower"
check_service "portainer" "http://localhost:9000"
check_service "redis"
check_service "nginx" "http://localhost:80"

# Verificar recursos
echo ""
echo "💾 Uso de Recursos:"
echo "CPU: $(docker stats --no-stream --format 'table {{.Container}}\t{{.CPUPerc}}\t{{.MemUsage}}' | grep -E 'whatsapp|traefik|watchtower|portainer|redis|nginx')"

# Verificar logs de erro
echo ""
echo "⚠️  Erros Recentes (última hora):"
for service in whatsapp-api traefik watchtower portainer redis nginx; do
    errors=$(docker-compose logs --since=1h $service 2>/dev/null | grep -i error | wc -l)
    if [ $errors -gt 0 ]; then
        echo "   $service: $errors erros"
    fi
done

# Verificar conectividade da API
echo ""
echo "🌐 Teste de Conectividade da API:"
if curl -s -f http://localhost:3000/health > /dev/null 2>&1; then
    echo "✅ API acessível via HTTP"
else
    echo "❌ API não acessível via HTTP"
fi

# Verificar QR Code
echo ""
echo "📱 Status WhatsApp:"
if docker-compose logs whatsapp-api | tail -50 | grep -q "QR code received"; then
    echo "✅ QR Code gerado - aguardando scan"
elif docker-compose logs whatsapp-api | tail -50 | grep -q "Client is ready"; then
    echo "✅ WhatsApp conectado"
else
    echo "⏳ Aguardando inicialização"
fi

# Espaço em disco
echo ""
echo "💽 Espaço em Disco:"
df -h | grep -E 'Filesystem|/var/lib/docker'

echo ""
echo "🔄 Para logs em tempo real:"
echo "   docker-compose logs -f [serviço]"
echo ""
echo "🚨 Para reiniciar um serviço:"
echo "   docker-compose restart [serviço]"
