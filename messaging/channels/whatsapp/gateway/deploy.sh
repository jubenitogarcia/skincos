#!/bin/bash

# 🚀 Script de Deploy - WhatsApp API em Docker
# Versão: 2.0.0
# Data: 1 de agosto de 2025

set -e

echo "🚀 Iniciando deploy do WhatsApp API..."
echo "🌐 Domínio: wa.skincos.com.br"
echo ""

# Cores para output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Função para log colorido
log() {
    echo -e "${GREEN}[$(date '+%H:%M:%S')]${NC} $1"
}

warn() {
    echo -e "${YELLOW}[$(date '+%H:%M:%S')] WARNING:${NC} $1"
}

error() {
    echo -e "${RED}[$(date '+%H:%M:%S')] ERROR:${NC} $1"
}

# Verificar se Docker está instalado
if ! command -v docker &> /dev/null; then
    error "Docker não está instalado!"
    echo "Instale o Docker: https://docs.docker.com/get-docker/"
    exit 1
fi

# Verificar se Docker Compose está instalado
if ! command -v docker-compose &> /dev/null; then
    error "Docker Compose não está instalado!"
    echo "Instale o Docker Compose: https://docs.docker.com/compose/install/"
    exit 1
fi

# Verificar se estamos no diretório correto
if [ ! -f "bot_com_api.js" ]; then
    error "Arquivo bot_com_api.js não encontrado!"
    echo "Execute este script no diretório do projeto WhatsApp."
    exit 1
fi

# Criar diretórios necessários
log "📁 Criando diretórios necessários..."
mkdir -p logs
mkdir -p data/auth
mkdir -p data/cache

# Parar containers existentes
log "🛑 Parando containers existentes..."
docker-compose down --remove-orphans || warn "Nenhum container encontrado para parar"

# Limpar imagens antigas (opcional)
read -p "🗑️  Deseja remover imagens antigas do Docker? (y/N): " -n 1 -r
echo
if [[ $REPLY =~ ^[Yy]$ ]]; then
    log "🗑️  Removendo imagens antigas..."
    docker system prune -f
    docker image prune -f
fi

# Build da nova imagem
log "🔨 Construindo nova imagem Docker..."
docker-compose build --no-cache whatsapp-api

# Verificar se a build foi bem-sucedida
if [ $? -eq 0 ]; then
    log "✅ Build completada com sucesso!"
else
    error "❌ Falha na build da imagem!"
    exit 1
fi

# Iniciar os serviços
log "🚀 Iniciando serviços..."
docker-compose up -d

# Aguardar serviços ficarem prontos
log "⏳ Aguardando serviços ficarem prontos..."
sleep 30

# Verificar status dos containers
log "📊 Verificando status dos containers..."
docker-compose ps

# Verificar saúde da API
log "🏥 Verificando saúde da API..."
for i in {1..12}; do
    if curl -sf http://localhost:3001/status > /dev/null; then
        log "✅ API está respondendo!"
        break
    else
        if [ $i -eq 12 ]; then
            error "❌ API não está respondendo após 2 minutos!"
            echo "📋 Logs do container:"
            docker-compose logs whatsapp-api
            exit 1
        fi
        warn "⏳ Tentativa $i/12... Aguardando API..."
        sleep 10
    fi
done

# Mostrar informações de deploy
echo ""
log "🎉 Deploy concluído com sucesso!"
echo ""
echo -e "${BLUE}📋 Informações do Deploy:${NC}"
echo "🌐 URL Local: http://localhost:3001"
echo "🌐 URL Produção: https://wa.skincos.com.br"
echo "📊 Status: $(curl -s http://localhost:3001/status | jq -r '.message' 2>/dev/null || echo 'Verificando...')"
echo ""
echo -e "${BLUE}🔧 Comandos Úteis:${NC}"
echo "📋 Ver logs: docker-compose logs -f whatsapp-api"
echo "🔄 Reiniciar: docker-compose restart whatsapp-api"
echo "🛑 Parar: docker-compose down"
echo "📊 Status: docker-compose ps"
echo ""

# Verificar se precisa escanear QR Code
log "📱 Verificando se precisa escanear QR Code..."
qr_status=$(curl -s http://localhost:3001/qr | jq -r '.success' 2>/dev/null || echo 'false')
if [ "$qr_status" = "true" ]; then
    warn "📱 QR Code necessário! Acesse http://localhost:3001/qr para obter o código"
    echo "📋 Ou monitore os logs: docker-compose logs -f whatsapp-api"
else
    log "✅ WhatsApp já autenticado!"
fi

# Configuração de monitoramento
echo ""
echo -e "${BLUE}📈 Monitoramento:${NC}"
echo "📊 Dashboard Traefik: http://localhost:8080"
echo "🏥 Health Check: curl http://localhost:3001/status"
echo "📋 API Docs: http://localhost:3001/"

# Script de health check contínuo
cat > health_check.sh << 'EOF'
#!/bin/bash
while true; do
    status=$(curl -s http://localhost:3001/status | jq -r '.ready' 2>/dev/null || echo 'false')
    if [ "$status" = "true" ]; then
        echo "✅ $(date '+%H:%M:%S') - API OK"
    else
        echo "❌ $(date '+%H:%M:%S') - API DOWN"
        # Opcional: reiniciar container automaticamente
        # docker-compose restart whatsapp-api
    fi
    sleep 30
done
EOF

chmod +x health_check.sh

echo ""
log "🎯 Deploy finalizado! Execute './health_check.sh' para monitoramento contínuo."
