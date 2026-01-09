@echo off
chcp 65001 >nul

echo 🚀 WhatsApp Bot + Cloudflare Tunnel
echo ===================================
echo.

echo 1️⃣ Iniciando containers Docker...
docker-compose up -d

echo.
echo 2️⃣ Aguardando API ficar online...
:wait_api
timeout /t 5 >nul
curl -s http://localhost:3001/status >nul 2>&1
if %errorlevel% neq 0 (
    echo ⏳ Aguardando API...
    goto wait_api
)

echo ✅ API online!

echo.
echo 3️⃣ Iniciando Cloudflare Tunnel...
start /min "Cloudflare Tunnel" cmd /c "cloudflared.exe tunnel --config cloudflare-config.yml run"

timeout /t 5 >nul

echo.
echo 🎉 TUDO INICIADO COM SUCESSO!
echo =============================
echo.
echo 🌐 URLs disponíveis:
echo ├─ Local: http://localhost:3001
echo ├─ Status: http://localhost:3001/status
echo └─ Público: https://wa.skincos.com.br
echo.

echo 🧪 Testando acesso público...
curl -s https://wa.skincos.com.br/status >nul 2>&1
if %errorlevel% equ 0 (
    echo ✅ Túnel funcionando!
) else (
    echo ⚠️ Túnel ainda conectando... aguarde alguns segundos
)

echo.
echo 📋 Para gerenciar:
echo ├─ Ver logs: docker logs whatsapp-api-prod -f
echo ├─ Parar tudo: docker-compose down
echo └─ Reiniciar: docker-compose restart
echo.

pause
