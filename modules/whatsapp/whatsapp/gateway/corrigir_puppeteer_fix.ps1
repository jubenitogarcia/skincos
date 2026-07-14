# Script PowerShell para corrigir problema do Puppeteer/Chromium

Write-Host "Corrigindo problema do Puppeteer/Chromium..." -ForegroundColor Cyan

# Parar container existente
Write-Host "Parando container existente..." -ForegroundColor Yellow
docker stop whatsapp-api-prod 2>$null
docker rm whatsapp-api-prod 2>$null

# Tentar diferentes abordagens
Write-Host "Construindo imagem com correcao do Puppeteer..." -ForegroundColor Blue

try {
    # Primeira tentativa: Dockerfile otimizado
    docker build -f Dockerfile.optimized -t whatsapp-api-optimized .

    if ($LASTEXITCODE -eq 0) {
        Write-Host "Build otimizado bem-sucedido!" -ForegroundColor Green
        $dockerfile = "otimizado"
    }
    else {
        throw "Build otimizado falhou"
    }
}
catch {
    Write-Host "Build otimizado falhou, tentando versao simples..." -ForegroundColor Yellow

    # Segunda tentativa: Dockerfile simples
    docker build -f Dockerfile.simple-puppeteer -t whatsapp-api-optimized .

    if ($LASTEXITCODE -eq 0) {
        Write-Host "Build simples bem-sucedido!" -ForegroundColor Green
        $dockerfile = "simples"
    }
    else {
        Write-Host "Ambos os builds falharam!" -ForegroundColor Red
        exit 1
    }
}

# Criar container
Write-Host "Criando container..." -ForegroundColor Blue
docker run -d `
    --name whatsapp-api-prod `
    --restart=always `
    -p 3001:3001 `
    -v "${PWD}:/app" `
    -w /app `
    whatsapp-api-optimized

if ($LASTEXITCODE -ne 0) {
    Write-Host "Falha ao criar container!" -ForegroundColor Red
    exit 1
}

# Aguardar inicializacao
Write-Host "Aguardando inicializacao (30 segundos)..." -ForegroundColor Yellow
Start-Sleep -Seconds 30

# Testar Puppeteer
Write-Host "Testando Puppeteer no container..." -ForegroundColor Cyan
try {
    $puppeteerTest = docker exec whatsapp-api-prod node test_puppeteer.js 2>&1
    Write-Host $puppeteerTest -ForegroundColor Gray

    if ($puppeteerTest -like "*Teste do Puppeteer concluido com sucesso!*") {
        Write-Host "Puppeteer esta funcionando!" -ForegroundColor Green
    }
    else {
        Write-Host "Puppeteer pode ter problemas" -ForegroundColor Yellow
    }
}
catch {
    Write-Host "Erro ao testar Puppeteer" -ForegroundColor Red
}

# Verificar Chromium
Write-Host "Verificando Chromium no container..." -ForegroundColor Cyan
try {
    $chromiumCheck = docker exec whatsapp-api-prod bash -c "ls -la node_modules/puppeteer/.local-chromium/ 2>/dev/null || echo 'Chromium nao encontrado'"
    Write-Host $chromiumCheck -ForegroundColor Gray
}
catch {
    Write-Host "Erro ao verificar Chromium" -ForegroundColor Red
}

# Status do container
Write-Host "Status do container:" -ForegroundColor Cyan
docker ps | Select-String "whatsapp"

# Logs recentes
Write-Host "Logs recentes:" -ForegroundColor Cyan
docker logs --tail 20 whatsapp-api-prod

# Testar conectividade
Write-Host "Testando conectividade..." -ForegroundColor Yellow
try {
    $response = Invoke-RestMethod -Uri "http://localhost:3001/status" -TimeoutSec 5 -ErrorAction Stop
    Write-Host "API esta respondendo!" -ForegroundColor Green
}
catch {
    Write-Host "API ainda nao esta respondendo - aguarde mais alguns minutos" -ForegroundColor Yellow
}

Write-Host ""
Write-Host "CORRECAO APLICADA!" -ForegroundColor Green
Write-Host "Dockerfile usado: $dockerfile" -ForegroundColor White
Write-Host "Verificacoes realizadas:" -ForegroundColor White
Write-Host "  - Container criado" -ForegroundColor Gray
Write-Host "  - Puppeteer testado" -ForegroundColor Gray
Write-Host "  - Chromium verificado" -ForegroundColor Gray

Write-Host ""
Write-Host "Se ainda houver problemas:" -ForegroundColor Cyan
Write-Host "  1. Aguarde 5-10 minutos para inicializacao completa" -ForegroundColor Gray
Write-Host "  2. Verifique logs: docker logs whatsapp-api-prod" -ForegroundColor Gray
Write-Host "  3. Teste manual: docker exec whatsapp-api-prod node test_puppeteer.js" -ForegroundColor Gray

Write-Host ""
Write-Host "Script finalizado!" -ForegroundColor Green
