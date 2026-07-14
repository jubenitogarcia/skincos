@echo off
chcp 65001 >nul

echo 🔧 Correção Específica - Chrome Profile Issues
echo ===============================================
echo.

echo 📋 Problemas específicos do Chrome que serão corrigidos:
echo ├─ ✅ Profile locks no Chrome
echo ├─ ✅ X11 permissions no Docker
echo ├─ ✅ User data directory único
echo ├─ ✅ Cleanup automático de profiles antigos
echo └─ ✅ Virtual display otimizado
echo.

echo 1️⃣ Parando todos os containers...
docker-compose down --remove-orphans
docker stop $(docker ps -q) 2>nul

echo.
echo 2️⃣ Limpando recursos Docker...
docker system prune -f
docker volume prune -f

echo.
echo 3️⃣ Removendo dados de Chrome antigos...
if exist ".wwebjs_auth" (
    echo 🧹 Limpando .wwebjs_auth...
    rmdir /s /q .wwebjs_auth 2>nul
)

if exist "chrome_profiles" (
    echo 🧹 Limpando chrome_profiles...
    rmdir /s /q chrome_profiles 2>nul
)

echo.
echo 4️⃣ Rebuild com correções específicas...
docker-compose build --no-cache --progress=plain

echo.
echo 5️⃣ Iniciando com configurações otimizadas...
docker-compose up -d

echo.
echo 6️⃣ Aguardando Chrome inicializar (pode demorar 2-3 minutos)...
timeout /t 15 >nul

echo.
echo 📋 Verificando logs de inicialização:
docker logs whatsapp-api-prod --tail 20

echo.
echo 7️⃣ Testando conectividade Chrome...
set /a attempts=0
:wait_chrome
set /a attempts+=1
if %attempts% gtr 20 (
    echo ❌ Chrome não inicializou corretamente
    echo 📋 Logs completos:
    docker logs whatsapp-api-prod
    goto end
)

curl -s http://localhost:3001/status | findstr "ready" >nul 2>&1
if %errorlevel% neq 0 (
    echo ⏳ Tentativa %attempts%/20 - Aguardando Chrome...
    timeout /t 15 >nul
    goto wait_chrome
)

echo ✅ Chrome inicializado com sucesso!

echo.
echo 8️⃣ Verificação final...
echo 📊 Status atual:
curl -s http://localhost:3001/status

echo.
echo 🎉 CORREÇÃO CONCLUÍDA!
echo =====================
echo.
echo 💡 Se ainda tiver problemas:
echo ├─ Logs detalhados: docker logs whatsapp-api-prod -f
echo ├─ Reiniciar container: docker-compose restart
echo └─ Rebuild completo: docker-compose down ^&^& docker-compose up --build
echo.

echo 🌐 Acessando página QR...
start http://localhost:3001/qr.html

:end
echo.
pause
