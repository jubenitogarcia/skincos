# Script PowerShell para reinicializar WhatsApp API com otimização de vídeos

Write-Host "🔄 Reiniciando WhatsApp API com otimizações de vídeo..." -ForegroundColor Cyan

# Parar container existente
Write-Host "⏸️ Parando container existente..." -ForegroundColor Yellow
docker stop whatsapp-api-prod 2>$null
docker rm whatsapp-api-prod 2>$null

# Construir imagem otimizada
Write-Host "🏗️ Construindo imagem otimizada com FFmpeg..." -ForegroundColor Blue
docker build -f Dockerfile.optimized -t whatsapp-api-optimized .

if ($LASTEXITCODE -eq 0) {
    Write-Host "✅ Imagem construída com sucesso!" -ForegroundColor Green
}
else {
    Write-Host "❌ Erro ao construir imagem!" -ForegroundColor Red
    exit 1
}

# Criar novo container
Write-Host "📦 Criando novo container com otimização de vídeo..." -ForegroundColor Blue
docker run -d `
    --name whatsapp-api-prod `
    --restart=always `
    -p 3001:3001 `
    -v "${PWD}:/app" `
    -w /app `
    whatsapp-api-optimized

if ($LASTEXITCODE -eq 0) {
    Write-Host "✅ Container criado com sucesso!" -ForegroundColor Green
}
else {
    Write-Host "❌ Erro ao criar container!" -ForegroundColor Red
    exit 1
}

# Aguardar inicialização
Write-Host "⏳ Aguardando inicialização (60 segundos)..." -ForegroundColor Yellow
Start-Sleep -Seconds 60

# Verificar status
Write-Host "📊 Status do container:" -ForegroundColor Cyan
docker ps | Select-String "whatsapp"

Write-Host "📋 Logs recentes:" -ForegroundColor Cyan
docker logs --tail 10 whatsapp-api-prod

# Testar conectividade
Write-Host "🔍 Testando conectividade..." -ForegroundColor Yellow
try {
    $response = Invoke-RestMethod -Uri "http://localhost:3001/status" -TimeoutSec 5 -ErrorAction Stop
    Write-Host "✅ API está respondendo!" -ForegroundColor Green
}
catch {
    Write-Host "⚠️ API ainda não está respondendo - aguarde mais alguns minutos" -ForegroundColor Yellow
}

Write-Host "`n🎬 OTIMIZAÇÃO DE VÍDEOS ATIVADA!" -ForegroundColor Green
Write-Host "📊 Funcionalidades:" -ForegroundColor White
Write-Host "  ✅ Vídeos >25MB são otimizados automaticamente" -ForegroundColor Gray
Write-Host "  ✅ Duração limitada a 60 segundos" -ForegroundColor Gray
Write-Host "  ✅ Tamanho reduzido para ~20MB" -ForegroundColor Gray
Write-Host "  ✅ Qualidade mantida para WhatsApp" -ForegroundColor Gray

Write-Host "`n🧪 Para testar com BigBuckBunny:" -ForegroundColor Cyan
Write-Host "Invoke-RestMethod -Uri `"http://localhost:3001/send`" -Method POST -ContentType `"application/json`" -Body '{\`"number\`": \`"555195103563\`", \`"type\`": \`"video\`", \`"url\`": \`"https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4\`", \`"message\`": \`"🐰 BigBuckBunny otimizado!\`"}'" -ForegroundColor Gray

Write-Host "`n✅ Script finalizado!" -ForegroundColor Green
