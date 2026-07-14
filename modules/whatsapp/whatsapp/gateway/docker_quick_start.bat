@echo off
chcp 65001 >nul

echo 🐳 WhatsApp Bot - Docker Quick Start
echo ====================================
echo.

echo 🔍 Verificando se a imagem existe...
docker images | findstr whatsapp-whatsapp-api >nul
if %errorlevel% neq 0 (
    echo ❌ Imagem não encontrada! Execute o build primeiro.
    echo 💡 Execute: docker-compose build
    pause
    exit /b 1
)

echo ✅ Imagem encontrada!
echo.

echo 🚀 Iniciando containers...
docker-compose up -d

echo.
echo ⏳ Aguardando containers iniciarem...
timeout /t 10 >nul

echo.
echo 📊 Status dos containers:
docker-compose ps

echo.
echo 🌐 URLs disponíveis:
echo ├─ API Local: http://localhost:3001
echo ├─ Status: http://localhost:3001/status
echo ├─ Docs: http://localhost:3001/
echo └─ Traefik Dashboard: http://localhost:8081

echo.
echo 🔍 Testando API...
curl -s http://localhost:3001/status 2>nul | find "timestamp" >nul
if %errorlevel% equ 0 (
    echo ✅ API está respondendo!
) else (
    echo ⚠️ API ainda inicializando... aguarde alguns segundos
)

echo.
echo 📱 Para ver os logs do WhatsApp:
echo    docker logs whatsapp-api-prod -f
echo.
echo 🛑 Para parar:
echo    docker-compose down
echo.

pause
