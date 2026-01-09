@echo off
chcp 65001 >nul

echo 🚀 WhatsApp Docker - Setup Completo
echo ====================================
echo.

echo 1️⃣ Iniciando containers Docker...
docker-compose up -d

echo.
echo 2️⃣ Aguardando API ficar online...
:wait_api
timeout /t 3 >nul
curl -s http://localhost:3001/status >nul 2>&1
if %errorlevel% neq 0 (
    echo ⏳ Aguardando API inicializar...
    goto wait_api
)

echo ✅ API online!

echo.
echo 3️⃣ Verificando status do WhatsApp Bot...
for /f "tokens=*" %%i in ('curl -s http://localhost:3001/status') do set status_response=%%i

echo %status_response% | find "qrRequired" | find "true" >nul
if %errorlevel% equ 0 (
    echo 📱 QR CODE NECESSÁRIO!
    echo.
    echo 🔗 Acesse uma dessas URLs para escanear o QR Code:
    echo    http://localhost:3001/qr.html (Interface amigável)
    echo    http://localhost:3001/qr (JSON)
    echo.
    echo 💡 Abrindo página do QR Code automaticamente...
    start http://localhost:3001/qr.html
    echo.
    echo ⏳ Aguardando autenticação...

    :wait_auth
    timeout /t 5 >nul
    curl -s http://localhost:3001/status | find "ready.*true" >nul
    if %errorlevel% neq 0 (
        echo ⏳ Ainda aguardando autenticação...
        goto wait_auth
    )

    echo ✅ WhatsApp autenticado com sucesso!
) else (
    echo %status_response% | find "ready.*true" >nul
    if %errorlevel% equ 0 (
        echo ✅ WhatsApp já autenticado!
    ) else (
        echo ⏳ WhatsApp conectando...
    )
)

echo.
echo 🎉 SETUP COMPLETO!
echo ==================
echo.
echo 🌐 URLs disponíveis:
echo ├─ API Status: http://localhost:3001/status
echo ├─ QR Code: http://localhost:3001/qr
echo ├─ API Docs: http://localhost:3001/
echo └─ Traefik: http://localhost:8081
echo.

echo 📱 Para testar envio de mensagem:
echo    POST http://localhost:3001/send
echo    Body: {"number": "5511999999999", "message": "Teste"}
echo.

echo 📋 Comandos úteis:
echo ├─ Ver logs: docker logs whatsapp-api-prod -f
echo ├─ Parar: docker-compose down
echo └─ Restart: docker-compose restart
echo.

echo 🚀 Iniciar Cloudflare Tunnel? (s/n)
set /p tunnel_choice="Escolha: "

if /i "%tunnel_choice%"=="s" (
    echo.
    echo 🌐 Iniciando Cloudflare Tunnel...
    start /min "Cloudflare Tunnel" cmd /c "cloudflared.exe tunnel --config cloudflare-config.yml run"
    timeout /t 3 >nul
    echo ✅ Túnel iniciado! URL: https://wa.skincos.com.br
)

echo.
pause
