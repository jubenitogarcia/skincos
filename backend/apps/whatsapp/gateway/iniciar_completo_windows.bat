@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion

echo 🤖 Inicializador Completo - WhatsApp Bot com API (Windows)
echo =============================================================
echo.

REM Verificar se Node.js está instalado
node --version >nul 2>&1
if %errorlevel% neq 0 (
    echo ❌ Node.js não encontrado! Instale o Node.js primeiro.
    pause
    exit /b 1
)

echo ✅ Node.js encontrado:
node --version

REM Verificar se as dependências estão instaladas
if not exist "node_modules" (
    echo 📦 Instalando dependências...
    npm install
    echo ✅ Dependências instaladas!
) else (
    echo ✅ Dependências já instaladas
)

echo.
echo 🚀 Escolha uma opção:
echo.
echo 1. Bot Básico (meu_bot.js)
echo 2. Bot Avançado (bot_avancado.js)
echo 3. Bot com API REST (bot_com_api.js)
echo 4. Sistema E-commerce Exemplo (sistema_exemplo.js)
echo 5. Cliente API - Teste (cliente_api.js test)
echo 6. Ambiente Completo (Bot API + Sistema Exemplo)
echo 7. Monitorar Bot (cliente_api.js monitor)
echo 8. 🐳 Docker Quick Start (usar imagem existente)
echo 9. 🌐 Docker + Cloudflare Tunnel
echo 10. Configurar Cloudflare Tunnel
echo 11. Controlar Sessão WhatsApp
echo 12. Gerenciar Docker (start/stop/logs)
echo.

set /p choice="Digite sua escolha (1-12): "

if "%choice%"=="1" (
    echo ▶️ Iniciando Bot Básico...
    node meu_bot.js
) else if "%choice%"=="2" (
    echo ▶️ Iniciando Bot Avançado...
    node bot_avancado.js
) else if "%choice%"=="3" (
    echo ▶️ Iniciando Bot com API REST...
    echo 🌐 API estará disponível em: http://localhost:3001
    node bot_com_api.js
) else if "%choice%"=="4" (
    echo ▶️ Iniciando Sistema E-commerce Exemplo...
    echo 🏪 Sistema estará disponível em: http://localhost:3002
    echo ⚠️ Certifique-se de que o bot_com_api.js está rodando primeiro!
    node sistema_exemplo.js
) else if "%choice%"=="5" (
    echo ▶️ Testando Cliente API...
    node cliente_api.js test
) else if "%choice%"=="6" (
    echo ▶️ Iniciando Ambiente Completo...
    echo 🔧 Este modo inicia o Bot API e Sistema Exemplo simultaneamente
    echo.
    echo ⚠️ Ambiente completo requer dois terminais separados no Windows
    echo 💡 Abra outro terminal e rode: node sistema_exemplo.js
    echo 📱 Bot API: http://localhost:3001
    echo 🏪 Sistema E-commerce: http://localhost:3002
    echo.
    node bot_com_api.js
) else if "%choice%"=="7" (
    echo ▶️ Monitorando Bot...
    echo 📊 Verificando status a cada 5 segundos...
    echo 🛑 Pressione Ctrl+C para parar
    node cliente_api.js monitor
) else if "%choice%"=="8" (
    echo ▶️ 🐳 Docker Quick Start...
    echo 🚀 Iniciando containers com imagem já construída
    call docker_quick_start.bat
) else if "%choice%"=="9" (
    echo ▶️ 🌐 Docker + Cloudflare Tunnel...
    echo 🔗 Iniciando containers + túnel público
    call docker_tunnel_completo.bat
) else if "%choice%"=="10" (
    echo ▶️ Configurando Cloudflare Tunnel...
    echo 🌐 Será criado túnel para: https://wa.skincos.com.br
    call setup_cloudflare_tunnel_windows.bat
) else if "%choice%"=="11" (
    echo ▶️ 🎮 Controle de Sessão WhatsApp...
    call controlar_whatsapp.bat
) else if "%choice%"=="12" (
    echo ▶️ 🐳 Gerenciar Docker...
    echo.
    echo 1. Start containers
    echo 2. Stop containers
    echo 3. Ver logs
    echo 4. Ver status
    echo 5. Restart containers
    echo.
    set /p docker_choice="Escolha (1-5): "

    if "!docker_choice!"=="1" (
        call whatsapp_docker.bat
    ) else if "!docker_choice!"=="2" (
        call whatsapp_docker.bat stop
    ) else if "!docker_choice!"=="3" (
        call whatsapp_docker.bat logs
    ) else if "!docker_choice!"=="4" (
        call whatsapp_docker.bat status
    ) else if "!docker_choice!"=="5" (
        call whatsapp_docker.bat restart
    )
) else (
    echo ❌ Opção inválida! Use 1-12
    pause
    exit /b 1
)

pause
