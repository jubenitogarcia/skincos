@echo off
chcp 65001 >nul

echo 🤖 INICIAR API + TÚNEL COMPLETO
echo ================================
echo.

echo 🔍 1. VERIFICANDO CREDENCIAIS...
if not exist "%USERPROFILE%\.cloudflared\d111123b-da44-45f1-adf1-35303be34865.json" (
    echo ❌ Credenciais não encontradas!
    echo 💡 Execute primeiro: migrar_tunnel_macos_windows.bat
    pause
    exit /b 1
)
echo ✅ Credenciais encontradas!

echo.
echo 🚀 2. INICIANDO API WHATSAPP...
echo Verificando se já está rodando...
tasklist /FI "WINDOWTITLE eq WhatsApp API*" 2>nul | find /I "node.exe" >nul
if %errorlevel% neq 0 (
    echo 🤖 Iniciando nova instância da API...
    start "WhatsApp API" cmd /k "echo 🤖 WhatsApp Bot API - Mantenha esta janela aberta && node bot_com_api.js"
    echo ⏱️ Aguardando API inicializar...
    timeout /t 8 /nobreak >nul
) else (
    echo ✅ API já está rodando!
)

echo.
echo 🌐 3. INICIANDO CLOUDFLARE TUNNEL...
echo 🔗 URL Pública: https://wa.skincos.com.br
echo 📊 Status: https://wa.skincos.com.br/status
echo 🔍 Health: https://wa.skincos.com.br/health
echo.
echo 🛑 Pressione Ctrl+C para parar o túnel
echo ⚡ A API continuará rodando em janela separada
echo.

.\cloudflared.exe tunnel --config cloudflare-config.yml run

echo.
echo 📱 Túnel encerrado.
echo 💡 A API ainda está rodando na outra janela.
pause
