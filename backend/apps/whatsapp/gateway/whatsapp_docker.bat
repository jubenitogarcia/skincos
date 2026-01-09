@echo off
chcp 65001 >nul

if "%1"=="stop" goto stop
if "%1"=="logs" goto logs
if "%1"=="status" goto status
if "%1"=="restart" goto restart

:start
echo 🚀 Iniciando WhatsApp Bot...
docker-compose up -d
echo ✅ Containers iniciados!
echo 📱 API: http://localhost:3001/status
goto end

:stop
echo 🛑 Parando WhatsApp Bot...
docker-compose down
echo ✅ Containers parados!
goto end

:logs
echo 📋 Logs do WhatsApp Bot:
docker logs whatsapp-api-prod -f
goto end

:status
echo 📊 Status dos containers:
docker-compose ps
echo.
echo 🌐 Testando API:
curl -s http://localhost:3001/status
goto end

:restart
echo 🔄 Reiniciando WhatsApp Bot...
docker-compose restart
echo ✅ Containers reiniciados!
goto end

:end
if "%1"=="" pause
