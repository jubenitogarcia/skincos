# Script PowerShell para reinicializar com correção do Chrome

Write-Host "🔄 Reiniciando WhatsApp API com correção do Chrome..." -ForegroundColor Cyan

# Parar container existente
Write-Host "⏸️ Parando container existente..." -ForegroundColor Yellow
docker stop whatsapp-api-prod 2>$null
docker rm whatsapp-api-prod 2>$null

Write-Host "🧪 Testando diferentes abordagens de Docker..." -ForegroundColor Blue

# Tentar primeiro com imagem Puppeteer (mais confiável)
Write-Host "📦 Tentativa 1: Usando imagem Puppeteer oficial..." -ForegroundColor Blue
try {
    docker build -f Dockerfile.puppeteer -t whatsapp-api-puppeteer . 2>$null

    if ($LASTEXITCODE -eq 0) {
        Write-Host "✅ Build da imagem Puppeteer bem-sucedido!" -ForegroundColor Green

        docker run -d `
            --name whatsapp-api-prod `
            --restart=always `
            -p 3001:3001 `
            -v "${PWD}:/app" `
            -w /app `
            whatsapp-api-puppeteer

        Write-Host "✅ Container criado com imagem Puppeteer!" -ForegroundColor Green
        $imageUsed = "Puppeteer"
    }
    else {
        throw "Falha no build Puppeteer"
    }
}
catch {
    Write-Host "❌ Falha na imagem Puppeteer, tentando otimizada..." -ForegroundColor Yellow

    # Se falhar, tentar com nossa imagem otimizada
    Write-Host "📦 Tentativa 2: Usando imagem otimizada..." -ForegroundColor Blue
    docker build -f Dockerfile.optimized -t whatsapp-api-optimized .

    if ($LASTEXITCODE -eq 0) {
        docker run -d `
            --name whatsapp-api-prod `
            --restart=always `
            -p 3001:3001 `
            -v "${PWD}:/app" `
            -w /app `
            whatsapp-api-optimized

        Write-Host "✅ Container criado com imagem otimizada!" -ForegroundColor Green
        $imageUsed = "Otimizada"
    }
    else {
        Write-Host "❌ Falha em ambas as imagens!" -ForegroundColor Red
        exit 1
    }
}

# Aguardar inicialização
Write-Host "⏳ Aguardando inicialização (60 segundos)..." -ForegroundColor Yellow
Start-Sleep -Seconds 60

# Verificar status
Write-Host "📊 Status do container:" -ForegroundColor Cyan
docker ps | Select-String "whatsapp"

Write-Host "📋 Logs recentes:" -ForegroundColor Cyan
docker logs --tail 15 whatsapp-api-prod

# Testar conectividade
Write-Host "🔍 Testando conectividade..." -ForegroundColor Yellow
try {
    $response = Invoke-RestMethod -Uri "http://localhost:3001/status" -TimeoutSec 5 -ErrorAction Stop
    Write-Host "✅ API está respondendo!" -ForegroundColor Green
}
catch {
    Write-Host "⚠️ API ainda não está respondendo - normal nos primeiros minutos" -ForegroundColor Yellow
}

# Verificar Chrome no container
Write-Host "🎬 Testando detecção do Chrome no container..." -ForegroundColor Cyan
try {
    $chromeStable = docker exec whatsapp-api-prod which google-chrome-stable 2>$null
    if ($chromeStable) {
        Write-Host "✅ Chrome stable encontrado: $chromeStable" -ForegroundColor Green
    }
    else {
        $chrome = docker exec whatsapp-api-prod which google-chrome 2>$null
        if ($chrome) {
            Write-Host "✅ Chrome encontrado: $chrome" -ForegroundColor Green
        }
        else {
            Write-Host "⚠️ Chrome não encontrado - usando padrão do Puppeteer" -ForegroundColor Yellow
        }
    }
}
catch {
    Write-Host "⚠️ Não foi possível verificar Chrome no container" -ForegroundColor Yellow
}

Write-Host "`n🎉 REINICIALIZAÇÃO CONCLUÍDA!" -ForegroundColor Green
Write-Host "📊 Imagem usada: $imageUsed" -ForegroundColor White
Write-Host "🔧 Correções aplicadas:" -ForegroundColor White
Write-Host "  ✅ Detecção automática do Chrome" -ForegroundColor Gray
Write-Host "  ✅ Otimização de vídeos com FFmpeg" -ForegroundColor Gray
Write-Host "  ✅ Fallback para diferentes caminhos do Chrome" -ForegroundColor Gray

Write-Host "`n📖 Aguarde alguns minutos para:" -ForegroundColor Cyan
Write-Host "  1. Inicialização completa do WhatsApp Web" -ForegroundColor Gray
Write-Host "  2. Geração do QR Code" -ForegroundColor Gray
Write-Host "  3. Ativação da API" -ForegroundColor Gray

Write-Host "`n🌐 Acesso:" -ForegroundColor Yellow
Write-Host "  Status: http://localhost:3001/status" -ForegroundColor Gray
Write-Host "  QR Code: http://localhost:3001/qr.html" -ForegroundColor Gray

Write-Host "`n✅ Script finalizado!" -ForegroundColor Green
