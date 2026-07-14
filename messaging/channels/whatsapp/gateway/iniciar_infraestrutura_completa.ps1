# PowerShell script para iniciar infraestrutura completa
Write-Host "🚀 Iniciando Infraestrutura Completa WhatsApp (PowerShell)" -ForegroundColor Cyan
Write-Host "=======================================================" -ForegroundColor Cyan

# Função para exibir status
function Write-Status {
    param($Message)
    Write-Host "[INFO] $Message" -ForegroundColor Blue
}

function Write-Success {
    param($Message)
    Write-Host "[SUCCESS] $Message" -ForegroundColor Green
}

function Write-Warning {
    param($Message)
    Write-Host "[WARNING] $Message" -ForegroundColor Yellow
}

function Write-Error {
    param($Message)
    Write-Host "[ERROR] $Message" -ForegroundColor Red
}

# Verificar se Docker está rodando
Write-Status "Verificando Docker..."
try {
    docker info | Out-Null
    Write-Success "Docker está ativo"
}
catch {
    Write-Error "Docker não está rodando. Inicie o Docker Desktop primeiro."
    Read-Host "Pressione Enter para sair"
    exit 1
}

# Parar containers existentes
Write-Status "Parando containers existentes..."
docker-compose -f docker-compose.production.yml down --remove-orphans 2>$null

# Limpar sistema Docker
Write-Status "Limpando sistema Docker..."
docker system prune -f

# Criar redes necessárias
Write-Status "Criando redes Docker..."
docker network create whatsapp-network 2>$null

# Copiar configuração do Nginx
Write-Status "Configurando Nginx..."
Copy-Item nginx.production.conf nginx.conf -Force

# Build da imagem principal
Write-Status "Construindo imagem WhatsApp API..."
docker-compose -f docker-compose.production.yml build whatsapp-api

if ($LASTEXITCODE -ne 0) {
    Write-Error "Falha no build da imagem WhatsApp API"
    Read-Host "Pressione Enter para sair"
    exit 1
}

Write-Success "Imagem construída com sucesso"

# Iniciar todos os serviços
Write-Status "Iniciando todos os serviços..."
docker-compose -f docker-compose.production.yml up -d

# Aguardar inicialização
Write-Status "Aguardando inicialização dos serviços (60 segundos)..."
Start-Sleep -Seconds 60

# Verificar status dos containers
Write-Status "Verificando status dos containers..."
docker-compose -f docker-compose.production.yml ps

# Verificar logs da API
Write-Status "Verificando logs da API WhatsApp..."
docker-compose -f docker-compose.production.yml logs --tail=20 whatsapp-api

# Testar conectividade
Write-Status "Testando conectividade dos serviços..."

function Test-Service {
    param($Url, $ServiceName)
    try {
        Invoke-WebRequest -Uri $Url -TimeoutSec 5 -ErrorAction Stop | Out-Null
        Write-Success "$ServiceName está funcionando: $Url"
    }
    catch {
        Write-Warning "$ServiceName não responde ainda: $Url"
    }
}

Test-Service "http://localhost:3001/health" "WhatsApp API"
Test-Service "http://localhost:8080" "Traefik Dashboard"
Test-Service "http://localhost:8090" "Nginx"
Test-Service "http://localhost:9000" "Portainer"

Write-Host ""
Write-Host "================================================" -ForegroundColor Cyan
Write-Host "🎉 INFRAESTRUTURA WHATSAPP INICIADA COM SUCESSO" -ForegroundColor Cyan
Write-Host "================================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "📍 Serviços Disponíveis:" -ForegroundColor Green
Write-Host "   • WhatsApp API:      http://localhost:3001"
Write-Host "   • QR Code:           http://localhost:3001/qr"
Write-Host "   • API Status:        http://localhost:3001/status"
Write-Host "   • Traefik Dashboard: http://localhost:8080"
Write-Host "   • Nginx Files:       http://localhost:8090"
Write-Host "   • Portainer:         http://localhost:9000"
Write-Host "   • Redis:             localhost:6379"
Write-Host ""
Write-Host "🔧 Comandos Úteis:" -ForegroundColor Green
Write-Host "   • Ver logs API:      docker-compose -f docker-compose.production.yml logs -f whatsapp-api"
Write-Host "   • Reiniciar API:     docker-compose -f docker-compose.production.yml restart whatsapp-api"
Write-Host "   • Parar tudo:        docker-compose -f docker-compose.production.yml down"
Write-Host "   • Status geral:      docker-compose -f docker-compose.production.yml ps"
Write-Host ""
Write-Host "📱 Para conectar WhatsApp:" -ForegroundColor Green
Write-Host "   1. Acesse: http://localhost:3001/qr"
Write-Host "   2. Escaneie o QR Code com seu WhatsApp"
Write-Host "   3. Aguarde a mensagem 'Client is ready'"
Write-Host ""
Write-Host "✅ Infraestrutura pronta para uso!" -ForegroundColor Green

Read-Host "Pressione Enter para continuar"
