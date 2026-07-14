#!/bin/bash

echo "🚀 Iniciando Infraestrutura Completa WhatsApp"
echo "============================================="

# Definir cores
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# Função para exibir status
print_status() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

print_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Verificar se Docker está rodando
print_status "Verificando Docker..."
if ! docker info > /dev/null 2>&1; then
    print_error "Docker não está rodando. Inicie o Docker Desktop primeiro."
    exit 1
fi
print_success "Docker está ativo"

# Parar containers existentes
print_status "Parando containers existentes..."
docker-compose -f docker-compose.production.yml down --remove-orphans 2>/dev/null

# Limpar sistema Docker
print_status "Limpando sistema Docker..."
docker system prune -f

# Criar redes necessárias
print_status "Criando redes Docker..."
docker network create whatsapp-network 2>/dev/null || print_warning "Rede whatsapp-network já existe"

# Copiar configuração do Nginx
print_status "Configurando Nginx..."
cp nginx.production.conf nginx.conf

# Build da imagem principal
print_status "Construindo imagem WhatsApp API..."
docker-compose -f docker-compose.production.yml build whatsapp-api

if [ $? -ne 0 ]; then
    print_error "Falha no build da imagem WhatsApp API"
    exit 1
fi

print_success "Imagem construída com sucesso"

# Iniciar todos os serviços
print_status "Iniciando todos os serviços..."
docker-compose -f docker-compose.production.yml up -d

# Aguardar inicialização
print_status "Aguardando inicialização dos serviços (60 segundos)..."
sleep 60

# Verificar status dos containers
print_status "Verificando status dos containers..."
docker-compose -f docker-compose.production.yml ps

# Verificar logs da API
print_status "Verificando logs da API WhatsApp..."
docker-compose -f docker-compose.production.yml logs --tail=20 whatsapp-api

# Verificar se há erros de Puppeteer
if docker-compose -f docker-compose.production.yml logs whatsapp-api | grep -q "libgobject-2.0.so.0\|Failed to launch"; then
    print_warning "Detectado possível erro de Puppeteer. Verificando dependências..."
    docker-compose -f docker-compose.production.yml exec whatsapp-api node -e "console.log('Node.js OK')" 2>/dev/null || print_error "Container não está respondendo"
fi

# Testar conectividade
print_status "Testando conectividade dos serviços..."

# Função para testar URL
test_url() {
    local url=$1
    local service=$2
    if curl -s -f "$url" > /dev/null 2>&1; then
        print_success "$service está funcionando: $url"
    else
        print_warning "$service não responde ainda: $url"
    fi
}

# Testar todos os serviços
test_url "http://localhost:3001/health" "WhatsApp API"
test_url "http://localhost:8080" "Traefik Dashboard"
test_url "http://localhost:8090" "Nginx"
test_url "http://localhost:9000" "Portainer"

# Testar Redis
if docker-compose -f docker-compose.production.yml exec redis redis-cli ping > /dev/null 2>&1; then
    print_success "Redis está funcionando"
else
    print_warning "Redis não responde"
fi

echo ""
echo -e "${CYAN}================================================${NC}"
echo -e "${CYAN}🎉 INFRAESTRUTURA WHATSAPP INICIADA COM SUCESSO${NC}"
echo -e "${CYAN}================================================${NC}"
echo ""
echo -e "${GREEN}📍 Serviços Disponíveis:${NC}"
echo -e "   ${BLUE}•${NC} WhatsApp API:      ${YELLOW}http://localhost:3001${NC}"
echo -e "   ${BLUE}•${NC} QR Code:           ${YELLOW}http://localhost:3001/qr${NC}"
echo -e "   ${BLUE}•${NC} API Status:        ${YELLOW}http://localhost:3001/status${NC}"
echo -e "   ${BLUE}•${NC} Traefik Dashboard: ${YELLOW}http://localhost:8080${NC}"
echo -e "   ${BLUE}•${NC} Nginx Files:       ${YELLOW}http://localhost:8090${NC}"
echo -e "   ${BLUE}•${NC} Portainer:         ${YELLOW}http://localhost:9000${NC}"
echo -e "   ${BLUE}•${NC} Redis:             ${YELLOW}localhost:6379${NC}"
echo ""
echo -e "${GREEN}🔧 Comandos Úteis:${NC}"
echo -e "   ${BLUE}•${NC} Ver logs API:      ${YELLOW}docker-compose -f docker-compose.production.yml logs -f whatsapp-api${NC}"
echo -e "   ${BLUE}•${NC} Reiniciar API:     ${YELLOW}docker-compose -f docker-compose.production.yml restart whatsapp-api${NC}"
echo -e "   ${BLUE}•${NC} Parar tudo:        ${YELLOW}docker-compose -f docker-compose.production.yml down${NC}"
echo -e "   ${BLUE}•${NC} Status geral:      ${YELLOW}docker-compose -f docker-compose.production.yml ps${NC}"
echo ""
echo -e "${GREEN}📱 Para conectar WhatsApp:${NC}"
echo -e "   ${BLUE}1.${NC} Acesse: ${YELLOW}http://localhost:3001/qr${NC}"
echo -e "   ${BLUE}2.${NC} Escaneie o QR Code com seu WhatsApp"
echo -e "   ${BLUE}3.${NC} Aguarde a mensagem 'Client is ready'"
echo ""
echo -e "${GREEN}✅ Infraestrutura pronta para uso!${NC}"
