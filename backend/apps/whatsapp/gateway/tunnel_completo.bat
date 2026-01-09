@echo off
chcp 65001 >nul

echo 🌐 SETUP COMPLETO - Cloudflare Tunnel WhatsApp API
echo ===================================================
echo.

echo ✅ CREDENCIAIS MIGRADAS DO macOS
echo Túnel ID: d111123b-da44-45f1-adf1-35303be34865
echo URL: https://wa.skincos.com.br
echo.

echo 🔐 PASSO 1: VERIFICAÇÃO DE CERTIFICADO
echo =======================================
echo Verificando se já possui certificado...

if exist "%USERPROFILE%\.cloudflared\cert.pem" (
    echo ✅ Certificado já existe! Prosseguindo...
) else (
    echo ❌ Certificado não encontrado. Fazendo login...
    echo Uma janela do navegador deve abrir automaticamente.
    echo Se não abrir, copie e cole a URL mostrada no navegador.
    echo.

    .\cloudflared.exe tunnel login

    if %errorlevel% neq 0 (
        echo ❌ Erro no login. Tente novamente.
        pause
        exit /b 1
    )

    echo ✅ Login realizado com sucesso!
)
echo.

echo 🧪 PASSO 2: TESTANDO TÚNEL
echo ==========================
echo Verificando configuração...

.\cloudflared.exe tunnel info d111123b-da44-45f1-adf1-35303be34865

if %errorlevel% equ 0 (
    echo ✅ Túnel configurado corretamente!
) else (
    echo ⚠️ Aviso: Pode ser necessário configurar DNS
)

echo.
echo 🚀 PASSO 3: INICIANDO TÚNEL
echo ===========================
echo Verificando se API está rodando...

curl -s http://localhost:3001/status >nul 2>&1
if %errorlevel% neq 0 (
    echo ❌ API não está rodando. Iniciando...
    start "WhatsApp API" cmd /k "node bot_com_api.js"
    echo ⏱️ Aguardando 10 segundos para API inicializar...
    timeout /t 10 /nobreak >nul
)

echo ✅ Iniciando túnel...
echo.
echo 🌐 SUA API ESTARÁ DISPONÍVEL EM:
echo https://wa.skincos.com.br
echo https://wa.skincos.com.br/status
echo https://wa.skincos.com.br/health
echo.
echo 🛑 Pressione Ctrl+C para parar o túnel
echo ⚡ Mantenha esta janela aberta
echo.

.\cloudflared.exe tunnel --config cloudflare-config.yml run

echo.
echo 📱 Túnel encerrado. Pressione qualquer tecla...
pause >nul
