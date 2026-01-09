@echo off
chcp 65001 >nul

echo 🔄 Migração Cloudflare Tunnel - macOS para Windows
echo ==================================================
echo.

set TUNNEL_ID=d111123b-da44-45f1-adf1-35303be34865
set CRED_FILE=%USERPROFILE%\.cloudflared\%TUNNEL_ID%.json

echo 🔍 Verificando se já existe configuração...

if not exist "%USERPROFILE%\.cloudflared" (
    echo 📁 Criando diretório .cloudflared...
    mkdir "%USERPROFILE%\.cloudflared"
)

if exist "%CRED_FILE%" (
    echo ✅ Arquivo de credenciais já existe!
    echo 📁 Localização: %CRED_FILE%
) else (
    echo ❌ Arquivo de credenciais não encontrado!
    echo.
    echo 📋 OPÇÕES PARA OBTER AS CREDENCIAIS:
    echo.
    echo 1. COPIAR DO macOS (se tiver acesso):
    echo    - No macOS, execute: cat ~/.cloudflared/%TUNNEL_ID%.json
    echo    - Copie o conteúdo completo
    echo    - Cole quando solicitado abaixo
    echo.
    echo 2. RECRIAR O TÚNEL:
    echo    - Execute: setup_cloudflare_tunnel_windows.bat
    echo    - Isso criará um novo túnel
    echo.
    set /p opcao="Escolha 1 para colar credenciais ou 2 para recriar (1/2): "

    if "%opcao%"=="1" (
        echo.
        echo 📋 Cole o conteúdo do arquivo JSON abaixo e pressione Enter duas vezes:
        echo.

        REM Criar arquivo temporário para receber o JSON
        echo Digite/cole o JSON completo:
        set /p json_content="JSON: "

        if not "%json_content%"=="" (
            echo %json_content% > "%CRED_FILE%"
            echo ✅ Arquivo de credenciais criado!
        ) else (
            echo ❌ Nenhum conteúdo fornecido.
            pause
            exit /b 1
        )
    ) else if "%opcao%"=="2" (
        echo 🚀 Executando configuração completa...
        call setup_cloudflare_tunnel_windows.bat
        exit /b 0
    ) else (
        echo ❌ Opção inválida
        pause
        exit /b 1
    )
)

echo.
echo 🧪 TESTANDO CONFIGURAÇÃO
echo =======================

REM Verificar se cloudflared existe
if not exist "cloudflared.exe" (
    where cloudflared >nul 2>&1
    if %errorlevel% neq 0 (
        echo ❌ cloudflared não encontrado! Baixando...
        curl -L -o "cloudflared.exe" "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe"
        echo ✅ cloudflared baixado!
    )
)

echo 🔍 Testando conexão do túnel...
cloudflared tunnel --config cloudflare-config.yml info

if %errorlevel% equ 0 (
    echo ✅ Configuração válida!
    echo.
    echo 🌐 TÚNEL PRONTO PARA USO
    echo ======================
    echo URL: https://wa.skincos.com.br
    echo.
    echo Para iniciar o túnel, execute:
    echo    iniciar_tunnel_windows.bat
    echo.
    echo Ou escolha a opção 9 no menu principal:
    echo    iniciar_completo_windows.bat
) else (
    echo ❌ Erro na configuração
    echo 💡 Execute: setup_cloudflare_tunnel_windows.bat
)

echo.
pause
