@echo off
echo Parando containers Docker temporariamente...
docker-compose down

echo.
echo Iniciando API diretamente...
start "WhatsApp API" cmd /k "node bot_com_api.js"

echo.
echo Aguardando 5 segundos...
timeout /t 5 /nobreak >nul

echo.
echo Testando API local...
curl http://localhost:3001/status

echo.
echo Iniciando tunnel Cloudflare...
cloudflared.exe tunnel --config cloudflare-config.yml run

pause
