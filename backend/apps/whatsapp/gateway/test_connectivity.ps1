# Script PowerShell para testar a API
Write-Host "🔍 Testando conectividade na porta 3001..." -ForegroundColor Yellow

try {
    $response = Invoke-WebRequest -Uri "http://localhost:3001/health" -TimeoutSec 5 -ErrorAction Stop
    Write-Host " ✅ Health check OK" -ForegroundColor Green
}
catch {
    Write-Host " ⚠️ Health check falhou" -ForegroundColor Red
}

Write-Host "🔍 Testando endpoint status..." -ForegroundColor Yellow
try {
    $response = Invoke-WebRequest -Uri "http://localhost:3001/status" -TimeoutSec 5 -ErrorAction Stop
    Write-Host " ✅ Status OK" -ForegroundColor Green
}
catch {
    Write-Host " ⚠️ Status não disponível" -ForegroundColor Red
}

Write-Host "🌐 Testando acesso ao Traefik Dashboard..." -ForegroundColor Yellow
try {
    $response = Invoke-WebRequest -Uri "http://localhost:8080" -TimeoutSec 5 -ErrorAction Stop
    Write-Host " ✅ Traefik Dashboard OK" -ForegroundColor Green
}
catch {
    Write-Host " ⚠️ Traefik Dashboard não disponível" -ForegroundColor Red
}

Write-Host ""
Write-Host "📍 URLs importantes:" -ForegroundColor Cyan
Write-Host "   • API WhatsApp: http://localhost:3001"
Write-Host "   • QR Code: http://localhost:3001/qr"
Write-Host "   • Traefik Dashboard: http://localhost:8080"
Write-Host "   • Redis: localhost:6379"
