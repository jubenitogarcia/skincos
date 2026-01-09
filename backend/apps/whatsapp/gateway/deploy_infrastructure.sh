#!/bin/bash

# Script para deploy completo da infraestrutura Docker
set -e

echo "🚀 Iniciando deploy da infraestrutura completa..."

# Verificar se Docker e Docker Compose estão instalados
if ! command -v docker &> /dev/null; then
    echo "❌ Docker não encontrado. Instale o Docker primeiro."
    exit 1
fi

if ! command -v docker-compose &> /dev/null; then
    echo "❌ Docker Compose não encontrado. Instale o Docker Compose primeiro."
    exit 1
fi

# Parar containers antigos se existirem
echo "🛑 Parando containers antigos..."
docker-compose down --remove-orphans 2>/dev/null || true

# Criar rede externa se não existir
echo "🌐 Criando rede traefik..."
docker network create traefik 2>/dev/null || echo "Rede traefik já existe"

# Backup da configuração atual
if [ -f "docker-compose.yml" ]; then
    echo "💾 Fazendo backup da configuração atual..."
    cp docker-compose.yml docker-compose.backup.$(date +%Y%m%d_%H%M%S).yml
fi

# Usar nova configuração
echo "📋 Aplicando nova configuração..."
cp docker-compose.new.yml docker-compose.yml

# Build da imagem se necessário
echo "🔨 Construindo imagem da API..."
docker-compose build whatsapp-api

# Iniciar todos os serviços
echo "🚀 Iniciando todos os serviços..."
docker-compose up -d

# Aguardar serviços iniciarem
echo "⏳ Aguardando serviços iniciarem..."
sleep 30

# Verificar status dos serviços
echo "📊 Verificando status dos serviços..."
docker-compose ps

# Verificar health checks
echo "🏥 Verificando health checks..."
sleep 10

# Mostrar logs dos últimos minutos
echo "📝 Logs recentes da API:"
docker-compose logs --tail=20 whatsapp-api

echo ""
echo "✅ Deploy concluído!"
echo ""
echo "📍 Serviços disponíveis:"
echo "   • API WhatsApp: https://api.localhost"
echo "   • Portainer: https://portainer.localhost"
echo "   • Traefik Dashboard: https://traefik.localhost"
echo "   • Nginx: https://files.localhost"
echo ""
echo "🔧 Comandos úteis:"
echo "   • Ver logs: docker-compose logs -f [serviço]"
echo "   • Parar tudo: docker-compose down"
echo "   • Reiniciar API: docker-compose restart whatsapp-api"
echo "   • Status: docker-compose ps"
echo ""
echo "📖 Para mais informações, consulte os logs dos serviços."
