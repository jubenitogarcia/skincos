@echo off
chcp 65001 >nul

echo 🌐 Iniciador Cloudflare Tunnel - WhatsApp API (Windows)
echo =======================================================
echo.

REM Verificar se cloudflared existe
if not exist "cloudflared.exe" (
    where cloudflared >nul 2>&1
    if %errorlevel% neq 0 (
        echo ❌ cloudflared não encontrado!
        echo 💡 Execute primeiro: setup_cloudflare_tunnel_windows.bat
        pause
        exit /b 1
    )
    set CLOUDFLARED_CMD=cloudflared
) else (
    set CLOUDFLARED_CMD=cloudflared.exe
)

REM Verificar se existe configuração
if not exist "cloudflare-config.yml" (
    echo ❌ Configuração não encontrada!
    echo 💡 Execute primeiro: setup_cloudflare_tunnel_windows.bat
    pause
    exit /b 1
)

REM Verificar se WhatsApp API está rodando
echo 🔍 Verificando WhatsApp API...
curl -s http://localhost:3001/status >nul 2>&1
if %errorlevel% equ 0 (
    echo ✅ WhatsApp API está rodando na porta 3001
) else (
    echo ❌ WhatsApp API não está rodando!
    echo 🚀 Iniciando API automaticamente...
    start "WhatsApp API" cmd /k "node bot_com_api.js"
    echo ⏱️ Aguardando API inicializar...
    timeout /t 5 /nobreak >nul
)

echo.
echo 🚀 INICIANDO CLOUDFLARE TUNNEL
echo ==============================
echo 🌐 URL: https://wa.skincos.com.br
echo 📊 Status: https://wa.skincos.com.br/status
echo 📚 Docs: https://wa.skincos.com.br/
echo.
echo 🛑 Pressione Ctrl+C para parar o túnel
echo.

REM Executar o túnel
%CLOUDFLARED_CMD% tunnel --config cloudflare-config.yml run

echo.
echo 📱 TÚNEL ENCERRADO
echo Pressione qualquer tecla para sair...
pause >nul
