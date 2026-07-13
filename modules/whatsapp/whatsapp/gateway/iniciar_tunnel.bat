@echo off
chcp 65001 >nul

echo 🌐 Iniciando Túnel Cloudflare - WhatsApp API
echo ============================================
echo.

echo 📍 Diretório atual: %CD%
echo 🔧 Config: cloudflare-config.yml
echo 🌐 Domínio: wa.skincos.com.br
echo 🎯 Target: http://localhost:3001
echo.

echo 🧪 Testando API local primeiro...
curl -s http://localhost:3001/status >nul 2>&1
if %errorlevel% neq 0 (
    echo ❌ API local não está respondendo!
    echo 💡 Inicie o WhatsApp API primeiro:
    echo    - docker_quick_start.bat
    echo    - ou node bot_com_api.js
    echo.
    pause
    exit /b 1
)

echo ✅ API local OK!
echo.
echo 🚀 Iniciando túnel Cloudflare...
cloudflared.exe tunnel --config cloudflare-config.yml run

echo.
echo ❌ Túnel finalizado
pause
