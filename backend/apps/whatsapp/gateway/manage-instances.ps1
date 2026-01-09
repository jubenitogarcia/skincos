# Script PowerShell para gerenciar múltiplas instâncias WhatsApp
# Uso: .\manage-instances.ps1 [start|stop|restart|status] [instance]

param(
    [Parameter(Mandatory = $false)]
    [ValidateSet("start", "stop", "restart", "status", "logs", "build")]
    [string]$Command,

    [Parameter(Mandatory = $false)]
    [ValidateSet("1", "2", "all")]
    [string]$Instance
)

# Função para mostrar uso
function Show-Usage {
    Write-Host "Uso: .\manage-instances.ps1 [comando] [instância]" -ForegroundColor Blue
    Write-Host ""
    Write-Host "Comandos:"
    Write-Host "  start    - Iniciar instância"
    Write-Host "  stop     - Parar instância"
    Write-Host "  restart  - Reiniciar instância"
    Write-Host "  status   - Ver status de todas as instâncias"
    Write-Host "  logs     - Ver logs da instância"
    Write-Host "  build    - Fazer build da instância"
    Write-Host ""
    Write-Host "Instâncias disponíveis:"
    Write-Host "  1        - Instância principal (portas 3001, 8000, 9000, etc.)"
    Write-Host "  2        - Segunda instância (portas 3002, 8001, 9001, etc.)"
    Write-Host "  all      - Todas as instâncias"
    Write-Host ""
    Write-Host "Exemplos:"
    Write-Host "  .\manage-instances.ps1 start 1"
    Write-Host "  .\manage-instances.ps1 stop 2"
    Write-Host "  .\manage-instances.ps1 status"
    Write-Host "  .\manage-instances.ps1 logs 2"
}

# Função para verificar se Docker está rodando
function Test-Docker {
    try {
        docker info | Out-Null
        return $true
    }
    catch {
        Write-Host "❌ Docker não está rodando!" -ForegroundColor Red
        return $false
    }
}

# Função para mostrar status
function Show-Status {
    Write-Host "📊 Status das Instâncias WhatsApp" -ForegroundColor Blue
    Write-Host "=================================="

    Write-Host "`n🔥 Instância 1 (Principal):" -ForegroundColor Yellow
    Write-Host "  API: http://localhost:3001"
    Write-Host "  QR Code: http://localhost:3001/qr.html"
    Write-Host "  Portainer: http://localhost:9000"
    Write-Host "  Traefik: http://localhost:8080"

    $instance1Running = docker ps --format "{{.Names}}" | Select-String "whatsapp-api-prod"
    if ($instance1Running) {
        Write-Host "  Status: ✅ Rodando" -ForegroundColor Green
    }
    else {
        Write-Host "  Status: ❌ Parado" -ForegroundColor Red
    }

    Write-Host "`n🔥 Instância 2 (Segunda):" -ForegroundColor Yellow
    Write-Host "  API: http://localhost:3002"
    Write-Host "  QR Code: http://localhost:3002/qr.html"
    Write-Host "  Portainer: http://localhost:9001"
    Write-Host "  Traefik: http://localhost:8081"

    $instance2Running = docker ps --format "{{.Names}}" | Select-String "whatsapp-api-prod-2"
    if ($instance2Running) {
        Write-Host "  Status: ✅ Rodando" -ForegroundColor Green
    }
    else {
        Write-Host "  Status: ❌ Parado" -ForegroundColor Red
    }

    Write-Host "`n🐳 Containers Ativos:" -ForegroundColor Blue
    $whatsappContainers = docker ps --format "table {{.Names}}`t{{.Status}}`t{{.Ports}}" | Select-String -Pattern "(whatsapp|traefik|redis|nginx|portainer|watchtower)"
    if ($whatsappContainers) {
        $whatsappContainers
    }
    else {
        Write-Host "Nenhum container WhatsApp ativo"
    }
}

# Função para iniciar instância
function Start-Instance {
    param([string]$InstanceNumber)

    switch ($InstanceNumber) {
        "1" {
            Write-Host "🚀 Iniciando Instância 1 (Principal)..." -ForegroundColor Green
            docker-compose -f docker-compose.production.yml up -d
            Write-Host "✅ Instância 1 iniciada!" -ForegroundColor Green
            Write-Host "🌐 API: http://localhost:3001"
            Write-Host "📱 QR Code: http://localhost:3001/qr.html"
        }
        "2" {
            Write-Host "🚀 Iniciando Instância 2..." -ForegroundColor Green
            docker-compose -f docker-compose.instance2.yml up -d
            Write-Host "✅ Instância 2 iniciada!" -ForegroundColor Green
            Write-Host "🌐 API: http://localhost:3002"
            Write-Host "📱 QR Code: http://localhost:3002/qr.html"
        }
        "all" {
            Write-Host "🚀 Iniciando todas as instâncias..." -ForegroundColor Green
            docker-compose -f docker-compose.production.yml up -d
            docker-compose -f docker-compose.instance2.yml up -d
            Write-Host "✅ Todas as instâncias iniciadas!" -ForegroundColor Green
        }
        default {
            Write-Host "❌ Instância inválida: $InstanceNumber" -ForegroundColor Red
            Show-Usage
            exit 1
        }
    }
}

# Função para parar instância
function Stop-Instance {
    param([string]$InstanceNumber)

    switch ($InstanceNumber) {
        "1" {
            Write-Host "🛑 Parando Instância 1..." -ForegroundColor Yellow
            docker-compose -f docker-compose.production.yml down
            Write-Host "✅ Instância 1 parada!" -ForegroundColor Green
        }
        "2" {
            Write-Host "🛑 Parando Instância 2..." -ForegroundColor Yellow
            docker-compose -f docker-compose.instance2.yml down
            Write-Host "✅ Instância 2 parada!" -ForegroundColor Green
        }
        "all" {
            Write-Host "🛑 Parando todas as instâncias..." -ForegroundColor Yellow
            docker-compose -f docker-compose.production.yml down
            docker-compose -f docker-compose.instance2.yml down
            Write-Host "✅ Todas as instâncias paradas!" -ForegroundColor Green
        }
        default {
            Write-Host "❌ Instância inválida: $InstanceNumber" -ForegroundColor Red
            Show-Usage
            exit 1
        }
    }
}

# Função para reiniciar instância
function Restart-Instance {
    param([string]$InstanceNumber)

    Write-Host "🔄 Reiniciando Instância $InstanceNumber..." -ForegroundColor Yellow
    Stop-Instance $InstanceNumber
    Start-Sleep -Seconds 2
    Start-Instance $InstanceNumber
}

# Função para mostrar logs
function Show-Logs {
    param([string]$InstanceNumber)

    switch ($InstanceNumber) {
        "1" {
            Write-Host "📋 Logs da Instância 1:" -ForegroundColor Blue
            docker-compose -f docker-compose.production.yml logs -f whatsapp-api
        }
        "2" {
            Write-Host "📋 Logs da Instância 2:" -ForegroundColor Blue
            docker-compose -f docker-compose.instance2.yml logs -f whatsapp-api-2
        }
        default {
            Write-Host "❌ Instância inválida: $InstanceNumber" -ForegroundColor Red
            Show-Usage
            exit 1
        }
    }
}

# Função para fazer build
function Build-Instance {
    param([string]$InstanceNumber)

    switch ($InstanceNumber) {
        "1" {
            Write-Host "🔨 Fazendo build da Instância 1..." -ForegroundColor Blue
            docker-compose -f docker-compose.production.yml build
            Write-Host "✅ Build da Instância 1 concluído!" -ForegroundColor Green
        }
        "2" {
            Write-Host "🔨 Fazendo build da Instância 2..." -ForegroundColor Blue
            docker-compose -f docker-compose.instance2.yml build
            Write-Host "✅ Build da Instância 2 concluído!" -ForegroundColor Green
        }
        "all" {
            Write-Host "🔨 Fazendo build de todas as instâncias..." -ForegroundColor Blue
            docker-compose -f docker-compose.production.yml build
            docker-compose -f docker-compose.instance2.yml build
            Write-Host "✅ Build de todas as instâncias concluído!" -ForegroundColor Green
        }
        default {
            Write-Host "❌ Instância inválida: $InstanceNumber" -ForegroundColor Red
            Show-Usage
            exit 1
        }
    }
}

# Verificar argumentos
if (-not $Command) {
    Show-Usage
    exit 1
}

# Verificar se Docker está rodando
if (-not (Test-Docker)) {
    exit 1
}

# Processar comandos
switch ($Command) {
    "start" {
        if (-not $Instance) {
            Write-Host "❌ Especifique a instância (1, 2 ou all)" -ForegroundColor Red
            Show-Usage
            exit 1
        }
        Start-Instance $Instance
    }
    "stop" {
        if (-not $Instance) {
            Write-Host "❌ Especifique a instância (1, 2 ou all)" -ForegroundColor Red
            Show-Usage
            exit 1
        }
        Stop-Instance $Instance
    }
    "restart" {
        if (-not $Instance) {
            Write-Host "❌ Especifique a instância (1, 2 ou all)" -ForegroundColor Red
            Show-Usage
            exit 1
        }
        Restart-Instance $Instance
    }
    "status" {
        Show-Status
    }
    "logs" {
        if (-not $Instance -or $Instance -eq "all") {
            Write-Host "❌ Especifique a instância (1 ou 2)" -ForegroundColor Red
            Show-Usage
            exit 1
        }
        Show-Logs $Instance
    }
    "build" {
        if (-not $Instance) {
            Write-Host "❌ Especifique a instância (1, 2 ou all)" -ForegroundColor Red
            Show-Usage
            exit 1
        }
        Build-Instance $Instance
    }
    default {
        Write-Host "❌ Comando inválido: $Command" -ForegroundColor Red
        Show-Usage
        exit 1
    }
}
