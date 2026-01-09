@echo off
echo ===========================================
echo    GERENCIAMENTO WHATSAPP vs AGENT ZERO
echo ===========================================

:menu
echo.
echo Escolha uma opcao:
echo [1] Iniciar WhatsApp (portas 3001, 8070, 8443, 8090)
echo [2] Parar WhatsApp (libera portas para Agent Zero)
echo [3] Iniciar Agent Zero (portas 80, 22, 8081, 5173)
echo [4] Parar Agent Zero
echo [5] Status dos containers
echo [6] Sair
echo.
set /p choice="Digite sua opcao (1-6): "

if "%choice%"=="1" goto start_whatsapp
if "%choice%"=="2" goto stop_whatsapp
if "%choice%"=="3" goto start_agent_zero
if "%choice%"=="4" goto stop_agent_zero
if "%choice%"=="5" goto status
if "%choice%"=="6" goto exit
echo Opcao invalida!
goto menu

:start_whatsapp
echo.
echo 🚀 Iniciando WhatsApp containers...
cd /d "C:\Automation\WhatsApp"
docker-compose up -d
echo.
echo ✅ WhatsApp iniciado!
echo 🌐 Acesso: http://localhost:3001/qr.html
echo 🔧 Traefik: http://localhost:8090
echo.
pause
goto menu

:stop_whatsapp
echo.
echo 🛑 Parando WhatsApp containers...
cd /d "C:\Automation\WhatsApp"
docker-compose down
echo.
echo ✅ WhatsApp parado! Portas liberadas para Agent Zero.
echo.
pause
goto menu

:start_agent_zero
echo.
echo 🚀 Iniciando Agent Zero...
echo.
echo Verificando se WhatsApp esta parado...
docker ps | findstr "whatsapp" >nul
if %errorlevel%==0 (
    echo ❌ ERRO: WhatsApp ainda esta rodando!
    echo ⚠️  Execute opcao 2 primeiro para parar o WhatsApp.
    pause
    goto menu
)

echo ✅ Portas livres. Iniciando Agent Zero...
docker run -d ^
  --name agent-zero ^
  --privileged ^
  -p 80:80 ^
  -p 22:22 ^
  -p 8081:8080 ^
  -p 5173:5173 ^
  -v "C:/Automation:/a0" ^
  -u 0:0 ^
  agent0ai/agent-zero

if %errorlevel%==0 (
    echo.
    echo ✅ Agent Zero iniciado com sucesso!
    echo 🌐 Acesso: http://localhost
    echo 📊 Dashboard: http://localhost:8081
    echo 🚀 Dev Server: http://localhost:5173
    echo 🔌 SSH: localhost:22
) else (
    echo.
    echo ❌ Erro ao iniciar Agent Zero!
)
echo.
pause
goto menu

:stop_agent_zero
echo.
echo 🛑 Parando Agent Zero...
docker stop agent-zero 2>nul
docker rm agent-zero 2>nul
echo.
echo ✅ Agent Zero parado! Portas liberadas para WhatsApp.
echo.
pause
goto menu

:status
echo.
echo 📊 STATUS DOS CONTAINERS:
echo.
echo === WhatsApp ===
docker ps --filter "name=whatsapp" --filter "name=traefik" --filter "name=watchtower" --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"
echo.
echo === Agent Zero ===
docker ps --filter "name=agent-zero" --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"
echo.
echo === Portas em uso ===
netstat -an | findstr ":80 :22 :3001 :8081 :5173 :8070 :8090 :8443" | findstr "LISTENING"
echo.
pause
goto menu

:exit
echo.
echo 👋 Ate logo!
exit /b 0
