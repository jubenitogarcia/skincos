# Script para iniciar o túnel Cloudflare
$scriptPath = "C:\Automation\WhatsApp"
Set-Location $scriptPath

Write-Host "Iniciando túnel Cloudflare..." -ForegroundColor Green
Start-Process -FilePath ".\cloudflared.exe" -ArgumentList "tunnel", "--config", "cloudflare-config.yml", "run" -WindowStyle Hidden

Write-Host "Túnel iniciado em background!" -ForegroundColor Green
Write-Host "Teste o acesso em: https://wa.skincos.com.br/status" -ForegroundColor Yellow
