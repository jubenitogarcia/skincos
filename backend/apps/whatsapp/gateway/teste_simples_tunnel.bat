@echo off
chcp 65001 >nul

echo 🚀 TESTE SIMPLES - Cloudflare Tunnel
echo =====================================
echo.

echo 🔍 1. VERIFICANDO ARQUIVO DE CREDENCIAIS...
if exist "%USERPROFILE%\.cloudflared\d111123b-da44-45f1-adf1-35303be34865.json" (
    echo ✅ Arquivo existe!
    echo 📄 Conteúdo:
    type "%USERPROFILE%\.cloudflared\d111123b-da44-45f1-adf1-35303be34865.json"
) else (
    echo ❌ Arquivo não encontrado!
    pause
    exit /b 1
)

echo.
echo 🔍 2. TESTANDO TÚNEL...
.\cloudflared.exe tunnel info d111123b-da44-45f1-adf1-35303be34865

echo.
echo 🔍 3. VERIFICANDO API LOCAL...
echo Testando http://localhost:3001/status...
curl -s http://localhost:3001/status
if %errorlevel% neq 0 (
    echo.
    echo ❌ API não está rodando. Execute em outro terminal:
    echo    node bot_com_api.js
    echo.
    echo ⏱️ Aguardando você iniciar a API... (Pressione qualquer tecla quando estiver pronta)
    pause >nul
)

echo.
echo 🚀 4. INICIANDO TÚNEL...
echo 🌐 Sua API estará em: https://wa.skincos.com.br
echo 📊 Status em: https://wa.skincos.com.br/status
echo.
echo 🛑 Pressione Ctrl+C para parar o túnel
echo.

.\cloudflared.exe tunnel --config cloudflare-config.yml run

echo.
echo 📱 Túnel encerrado.
pause
