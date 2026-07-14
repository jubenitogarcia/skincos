@echo off
chcp 65001 >nul

echo 🔧 Rebuild Docker - Correção de Erros WhatsApp
echo ===============================================
echo.

echo 📋 Problemas que serão corrigidos:
echo ├─ ✅ Configurações Puppeteer otimizadas
echo ├─ ✅ Tratamento de erro com retry automático
echo ├─ ✅ Virtual display (Xvfb) para Chrome
echo ├─ ✅ Mais tempo para health check
echo └─ ✅ Melhor gerenciamento de memória
echo.

echo 1️⃣ Parando containers existentes...
docker-compose down --remove-orphans

echo.
echo 2️⃣ Limpando imagens antigas...
docker system prune -f

echo.
echo 3️⃣ Reconstruindo imagem com correções...
docker-compose build --no-cache --progress=plain

echo.
echo 4️⃣ Iniciando containers...
docker-compose up -d

echo.
echo 5️⃣ Aguardando inicialização (pode demorar até 3 minutos)...
echo ⏳ Monitorando logs...

timeout /t 10 >nul

echo.
echo 📋 Verificando logs iniciais:
docker logs whatsapp-api-prod --tail 15

echo.
echo 6️⃣ Aguardando API ficar online...
set /a attempts=0
:wait_api
set /a attempts+=1
if %attempts% gtr 30 (
    echo ❌ Timeout - API não respondeu em 5 minutos
    echo 📋 Logs completos:
    docker logs whatsapp-api-prod
    goto end
)

curl -s http://localhost:3001/status >nul 2>&1
if %errorlevel% neq 0 (
    echo ⏳ Tentativa %attempts%/30 - Aguardando API...
    timeout /t 10 >nul
    goto wait_api
)

echo ✅ API está respondendo!

echo.
echo 7️⃣ Testando endpoints...
echo 📊 Status:
curl -s http://localhost:3001/status | findstr "ready\|status\|message"

echo.
echo 📱 Página QR:
curl -s http://localhost:3001/qr.html | find "WhatsApp Bot" >nul
if %errorlevel% equ 0 (
    echo ✅ Página QR funcionando
) else (
    echo ❌ Problema na página QR
)

echo.
echo 🎉 REBUILD CONCLUÍDO!
echo =====================
echo.
echo 🌐 URLs disponíveis:
echo ├─ Status: http://localhost:3001/status
echo ├─ QR Code: http://localhost:3001/qr.html
echo ├─ API: http://localhost:3001/
echo └─ Traefik: http://localhost:8081
echo.

echo 📋 Comandos úteis:
echo ├─ Ver logs: docker logs whatsapp-api-prod -f
echo ├─ Status containers: docker-compose ps
echo ├─ Restart: docker-compose restart
echo └─ Parar: docker-compose down
echo.

echo 💡 Abrindo página QR...
start http://localhost:3001/qr.html

:end
echo.
pause
