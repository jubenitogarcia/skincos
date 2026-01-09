# Script simples para usar imagem Puppeteer oficial

Write-Host "Usando imagem Puppeteer oficial para resolver problema..." -ForegroundColor Cyan

# Parar container existente
docker stop whatsapp-api-prod 2>$null
docker rm whatsapp-api-prod 2>$null

Write-Host "Criando container com imagem Puppeteer oficial..." -ForegroundColor Blue

# Usar imagem Puppeteer oficial que já tem Chrome
docker run -d `
    --name whatsapp-api-prod `
    --restart=always `
    -p 3001:3001 `
    -v "${PWD}:/app" `
    -w /app `
    ghcr.io/puppeteer/puppeteer:21.3.8 `
    sh -c "npm install && node bot_com_api.js"

Write-Host "Aguardando inicializacao (60 segundos)..." -ForegroundColor Yellow
Start-Sleep -Seconds 60

Write-Host "Status do container:" -ForegroundColor Cyan
docker ps | Select-String "whatsapp"

Write-Host "Logs recentes:" -ForegroundColor Cyan
docker logs --tail 15 whatsapp-api-prod

Write-Host "Testando API..." -ForegroundColor Yellow
try {
    $response = Invoke-RestMethod -Uri "http://localhost:3001/status" -TimeoutSec 5 -ErrorAction Stop
    Write-Host "API esta funcionando!" -ForegroundColor Green
}
catch {
    Write-Host "API ainda nao esta respondendo - aguarde mais alguns minutos" -ForegroundColor Yellow
}

Write-Host "Script finalizado! Container usando imagem Puppeteer oficial." -ForegroundColor Green
