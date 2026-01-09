@echo off
setlocal enabledelayedexpansion

REM Script para gerenciar múltiplas instâncias WhatsApp
REM Uso: manage-instances.bat [start|stop|status] [1|2|all]

set "command=%1"
set "instance=%2"

if "%command%"=="" (
    call :show_usage
    exit /b 1
)

if "%command%"=="help" (
    call :show_usage
    exit /b 0
)

REM Verificar se Docker está rodando
docker info >nul 2>&1
if errorlevel 1 (
    echo ❌ Docker não está rodando!
    exit /b 1
)

if "%command%"=="start" (
    if "%instance%"=="" (
        echo ❌ Especifique a instância: 1, 2 ou all
        call :show_usage
        exit /b 1
    )
    call :start_instance %instance%
) else if "%command%"=="stop" (
    if "%instance%"=="" (
        echo ❌ Especifique a instância: 1, 2 ou all
        call :show_usage
        exit /b 1
    )
    call :stop_instance %instance%
) else if "%command%"=="status" (
    call :show_status
) else if "%command%"=="restart" (
    if "%instance%"=="" (
        echo ❌ Especifique a instância: 1, 2 ou all
        call :show_usage
        exit /b 1
    )
    call :restart_instance %instance%
) else (
    echo ❌ Comando inválido: %command%
    call :show_usage
    exit /b 1
)

exit /b 0

:show_usage
echo.
echo 📱 Gerenciador de Instâncias WhatsApp
echo =====================================
echo.
echo Uso: %~nx0 [comando] [instância]
echo.
echo Comandos:
echo   start    - Iniciar instância
echo   stop     - Parar instância
echo   restart  - Reiniciar instância
echo   status   - Ver status de todas as instâncias
echo   help     - Mostrar esta ajuda
echo.
echo Instâncias:
echo   1        - Instância principal (portas 3001, 8000, 9000, etc.)
echo   2        - Segunda instância (portas 3002, 8001, 9001, etc.)
echo   all      - Todas as instâncias
echo.
echo Exemplos:
echo   %~nx0 start 1
echo   %~nx0 stop 2
echo   %~nx0 status
echo   %~nx0 restart all
echo.
exit /b 0

:show_status
echo.
echo 📊 Status das Instâncias WhatsApp
echo ==================================
echo.
echo 🔥 Instância 1 (Principal):
echo   API: http://localhost:3001
echo   QR Code: http://localhost:3001/qr.html
echo   Portainer: http://localhost:9000
echo   Traefik: http://localhost:8080

docker ps --format "{{.Names}}" | findstr /C:"whatsapp-api-prod" >nul 2>&1
if not errorlevel 1 (
    echo   Status: ✅ Rodando
) else (
    echo   Status: ❌ Parado
)

echo.
echo 🔥 Instância 2 (Segunda):
echo   API: http://localhost:3002
echo   QR Code: http://localhost:3002/qr.html
echo   Portainer: http://localhost:9001
echo   Traefik: http://localhost:8081

docker ps --format "{{.Names}}" | findstr /C:"whatsapp-api-prod-2" >nul 2>&1
if not errorlevel 1 (
    echo   Status: ✅ Rodando
) else (
    echo   Status: ❌ Parado
)

echo.
echo 🐳 Containers Ativos:
docker ps --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}" | findstr /C:"whatsapp"
if errorlevel 1 (
    echo Nenhum container WhatsApp ativo
)
echo.
exit /b 0

:start_instance
set "inst=%1"
if "%inst%"=="1" (
    echo 🚀 Iniciando Instância 1 (Principal)...
    docker-compose -f docker-compose.production.yml up -d
    if not errorlevel 1 (
        echo ✅ Instância 1 iniciada!
        echo 🌐 API: http://localhost:3001
        echo 📱 QR Code: http://localhost:3001/qr.html
    )
) else if "%inst%"=="2" (
    echo 🚀 Iniciando Instância 2...
    docker-compose -f docker-compose.instance2.yml up -d
    if not errorlevel 1 (
        echo ✅ Instância 2 iniciada!
        echo 🌐 API: http://localhost:3002
        echo 📱 QR Code: http://localhost:3002/qr.html
    )
) else if "%inst%"=="all" (
    echo 🚀 Iniciando todas as instâncias...
    docker-compose -f docker-compose.production.yml up -d
    docker-compose -f docker-compose.instance2.yml up -d
    echo ✅ Todas as instâncias iniciadas!
) else (
    echo ❌ Instância inválida: %inst%
    exit /b 1
)
exit /b 0

:stop_instance
set "inst=%1"
if "%inst%"=="1" (
    echo 🛑 Parando Instância 1...
    docker-compose -f docker-compose.production.yml down
    echo ✅ Instância 1 parada!
) else if "%inst%"=="2" (
    echo 🛑 Parando Instância 2...
    docker-compose -f docker-compose.instance2.yml down
    echo ✅ Instância 2 parada!
) else if "%inst%"=="all" (
    echo 🛑 Parando todas as instâncias...
    docker-compose -f docker-compose.production.yml down
    docker-compose -f docker-compose.instance2.yml down
    echo ✅ Todas as instâncias paradas!
) else (
    echo ❌ Instância inválida: %inst%
    exit /b 1
)
exit /b 0

:restart_instance
set "inst=%1"
echo 🔄 Reiniciando Instância %inst%...
call :stop_instance %inst%
timeout /t 3 /nobreak >nul
call :start_instance %inst%
exit /b 0
