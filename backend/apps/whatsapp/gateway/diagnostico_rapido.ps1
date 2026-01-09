# PowerShell script para diagnóstico rápido
Write-Host "🔍 Diagnóstico Rápido WhatsApp Docker" -ForegroundColor Cyan
Write-Host "===================================" -ForegroundColor Cyan

Write-Host "`n📦 Containers Docker:" -ForegroundColor Yellow
docker ps -a | Select-String "(whatsapp|traefik|redis|watchtower)"

Write-Host "`n🌐 Portas em uso:" -ForegroundColor Yellow
netstat -an | Select-String ":3001|:8080|:6379|:8000"

Write-Host "`n🔧 Status Docker Compose:" -ForegroundColor Yellow
try {
    docker-compose ps
}
catch {
    Write-Host "Docker Compose não funcionou" -ForegroundColor Red
}

Write-Host "`n📊 Logs da API (últimas 10 linhas):" -ForegroundColor Yellow
try {
    docker-compose logs --tail=10 whatsapp-api
}
catch {
    Write-Host "Logs não disponíveis" -ForegroundColor Red
}

Write-Host "`n🧪 Teste de conectividade:" -ForegroundColor Yellow
try {
    $response = Invoke-WebRequest -Uri "http://localhost:3001/health" -TimeoutSec 5 -ErrorAction Stop
    Write-Host "✅ API respondendo" -ForegroundColor Green
}
catch {
    Write-Host "❌ API não responde" -ForegroundColor Red
}

Write-Host "`n🏗️ Imagens Docker:" -ForegroundColor Yellow
docker images | Select-String "whatsapp"

Write-Host "`n📁 Arquivos principais:" -ForegroundColor Yellow
Get-ChildItem docker-compose.yml, Dockerfile.fast, bot_com_api.js -ErrorAction SilentlyContinue | Format-Table Name, Length, LastWriteTime
