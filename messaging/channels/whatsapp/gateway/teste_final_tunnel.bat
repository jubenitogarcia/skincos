@echo off
chcp 65001 >nul

echo 🚀 CLOUDFLARE TUNNEL - TESTE FINAL
echo ==================================
echo.

echo 🔍 1. TESTANDO CREDENCIAIS JSON...
powershell -Command "Get-Content \"$env:USERPROFILE\.cloudflared\d111123b-da44-45f1-adf1-35303be34865.json\" | ConvertFrom-Json | Format-Table"

if %errorlevel% neq 0 (
    echo ❌ JSON inválido!
    pause
    exit /b 1
)

echo ✅ JSON válido!
echo.

echo 🔍 2. TESTANDO INFORMAÇÕES DO TÚNEL...
.\cloudflared.exe tunnel info d111123b-da44-45f1-adf1-35303be34865

echo.
echo 🔍 3. VERIFICANDO API LOCAL...
curl -s http://localhost:3001/status
if %errorlevel% neq 0 (
    echo ❌ API não está rodando. Iniciando...
    start "WhatsApp API" cmd /k "echo 🤖 WhatsApp API Iniciando... && node bot_com_api.js"
    echo ⏱️ Aguarde 10 segundos para a API inicializar...
    timeout /t 10 /nobreak >nul
)

echo.
echo 🚀 4. INICIANDO TÚNEL...
echo 🌐 https://wa.skincos.com.br
echo 📊 https://wa.skincos.com.br/status
echo 🔗 https://wa.skincos.com.br/health
echo.
echo 🛑 Pressione Ctrl+C para parar
echo.

.\cloudflared.exe tunnel --config cloudflare-config.yml run

pause
