@echo off
chcp 65001 >nul

echo 🎮 Controle do WhatsApp Web
echo ============================
echo.

if "%1"=="" goto menu

if "%1"=="iniciar" (
    echo 🚀 Iniciando WhatsApp...
    node controlar_sessao.js iniciar
    goto end
)

if "%1"=="fechar" (
    echo 🔒 Fechando janela...
    node controlar_sessao.js fechar
    goto end
)

if "%1"=="abrir" (
    echo 🌐 Abrindo janela...
    node controlar_sessao.js abrir
    goto end
)

if "%1"=="refresh" (
    echo 🔄 Refreshing sessão...
    node controlar_sessao.js refresh
    goto end
)

if "%1"=="status" (
    echo 📊 Verificando status...
    node controlar_sessao.js status
    goto end
)

:menu
echo Escolha uma opção:
echo.
echo 1. Iniciar WhatsApp
echo 2. Fechar janela (manter sessão)
echo 3. Abrir nova janela
echo 4. Refresh (fechar e abrir)
echo 5. Ver status
echo 6. Sair
echo.

set /p choice="Digite sua escolha (1-6): "

if "%choice%"=="1" (
    node controlar_sessao.js iniciar
) else if "%choice%"=="2" (
    node controlar_sessao.js fechar
) else if "%choice%"=="3" (
    node controlar_sessao.js abrir
) else if "%choice%"=="4" (
    node controlar_sessao.js refresh
) else if "%choice%"=="5" (
    node controlar_sessao.js status
) else if "%choice%"=="6" (
    exit /b 0
) else (
    echo ❌ Opção inválida!
    pause
    goto menu
)

:end
pause
