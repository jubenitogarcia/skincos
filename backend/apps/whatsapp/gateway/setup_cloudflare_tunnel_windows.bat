@echo off
chcp 65001 >nul

echo 🌐 Configurador Cloudflare Tunnel - WhatsApp API (Windows)
echo ==========================================================
echo.

REM Verificar se cloudflared está instalado
where cloudflared >nul 2>&1
if %errorlevel% neq 0 (
    echo ❌ cloudflared não encontrado! Instalando automaticamente...
    echo.
    echo 📥 Baixando cloudflared para Windows...

    REM Criar diretório temporário se não existir
    if not exist "temp" mkdir temp

    REM Baixar cloudflared para Windows
    curl -L -o "temp\cloudflared.exe" "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe"

    if exist "temp\cloudflared.exe" (
        echo ✅ Download concluído!
        echo 📁 Movendo para local permanente...
        copy "temp\cloudflared.exe" "cloudflared.exe"
        del "temp\cloudflared.exe"
        rmdir "temp"
        echo ✅ cloudflared instalado localmente!
    ) else (
        echo ❌ Erro no download. Tente instalar manualmente:
        echo    winget install Cloudflare.cloudflared
        pause
        exit /b 1
    )
) else (
    echo ✅ cloudflared já está instalado
)

echo.

REM Verificar se WhatsApp API está rodando
echo 🔍 Verificando WhatsApp API...
curl -s http://localhost:3001/status >nul 2>&1
if %errorlevel% equ 0 (
    echo ✅ WhatsApp API está rodando na porta 3001
) else (
    echo ❌ WhatsApp API não está rodando!
    echo    Execute primeiro: node bot_com_api.js
    echo.
    pause
    exit /b 1
)

echo.
echo 🚀 CONFIGURAÇÃO DO TÚNEL
echo ========================
echo.

REM Verificar se já existe configuração
if exist "cloudflare-config.yml" (
    echo 📁 Configuração existente encontrada!
    echo 🔄 Deseja usar a configuração existente? (S/N)
    set /p use_existing="Digite S para usar existente, N para recriar: "
    if /i "%use_existing%"=="S" goto :run_tunnel
)

echo 🔐 1. Autenticação com Cloudflare
echo ================================
echo Execute o comando abaixo e faça login no navegador:
echo.
echo    cloudflared tunnel login
echo.
echo Após fazer login, pressione qualquer tecla...
pause >nul

echo.
echo 🚀 2. Criando túnel
echo ==================
set TUNNEL_NAME=whatsapp-api-windows-%RANDOM%
echo Criando túnel: %TUNNEL_NAME%

cloudflared tunnel create %TUNNEL_NAME%

if %errorlevel% neq 0 (
    echo ❌ Erro ao criar túnel
    pause
    exit /b 1
)

echo.
echo ⚙️ 3. Criando configuração
echo ========================

REM Criar arquivo de configuração
echo tunnel: %TUNNEL_NAME% > cloudflare-config.yml
echo credentials-file: %USERPROFILE%\.cloudflared\%TUNNEL_NAME%.json >> cloudflare-config.yml
echo. >> cloudflare-config.yml
echo ingress: >> cloudflare-config.yml
echo   - hostname: wa.skincos.com.br >> cloudflare-config.yml
echo     service: http://localhost:3001 >> cloudflare-config.yml
echo   - service: http_status:404 >> cloudflare-config.yml

echo ✅ Arquivo de configuração criado!

:run_tunnel
echo.
echo 🌍 4. CONFIGURAÇÃO DNS NO CLOUDFLARE
echo ====================================
echo 1. Acesse: https://dash.cloudflare.com
echo 2. Selecione: skincos.com.br
echo 3. Vá em: DNS ^> Records
echo 4. Execute o comando CNAME mostrado abaixo
echo.

echo 🎯 5. INICIANDO TÚNEL
echo ====================
echo Executando túnel...
echo.
echo 🌐 Sua API estará em: https://wa.skincos.com.br
echo.

REM Executar o túnel
cloudflared tunnel --config cloudflare-config.yml run

echo.
echo 📱 TÚNEL ENCERRADO
echo Pressione qualquer tecla para sair...
pause >nul
