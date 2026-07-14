@echo off
chcp 65001 >nul

echo 🌐 Iniciando Cloudflare Tunnel - WhatsApp API
echo ==============================================
echo.

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
    timeout /t 10 /nobreak >nul
)

echo.
echo 🚀 INICIANDO TÚNEL CLOUDFLARE
echo ============================
echo 🌐 URL Pública: https://wa.skincos.com.br
echo 📊 Status: https://wa.skincos.com.br/status
echo 📚 Documentação: https://wa.skincos.com.br/
echo 🔗 Teste: https://wa.skincos.com.br/health
echo.
echo 🛑 Pressione Ctrl+C para parar o túnel
echo ⚡ Mantenha esta janela aberta para manter o túnel ativo
echo.

REM Executar o túnel
.\cloudflared.exe tunnel --config cloudflare-config.yml run

echo.
echo 📱 TÚNEL ENCERRADO
echo Pressione qualquer tecla para sair...
pause >nul
