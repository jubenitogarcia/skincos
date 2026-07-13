@echo off
chcp 65001 >nul

echo 🔧 Rebuild e Teste do Chrome - Correção Puppeteer
echo ===================================================
echo.

echo 📋 Aplicando correções avançadas:
echo ├─ ✅ Configuração Puppeteer otimizada
echo ├─ ✅ Timeout e delays aumentados
echo ├─ ✅ Cleanup mais agressivo do Chrome
echo ├─ ✅ Teste específico do Chrome
echo └─ ✅ Display virtual otimizado
echo.

echo 1️⃣ Parando containers...
docker-compose down --remove-orphans

echo.
echo 2️⃣ Limpando cache Docker...
docker system prune -f

echo.
echo 3️⃣ Reconstruindo imagem...
docker-compose build --no-cache

echo.
echo 4️⃣ Iniciando container...
docker-compose up -d whatsapp-api

echo.
echo 5️⃣ Aguardando container inicializar...
timeout /t 30 >nul

echo.
echo 6️⃣ Testando Chrome dentro do container...
echo ⚗️ Executando teste específico do Chrome:
docker exec whatsapp-api-prod node test_chrome.js

if %errorlevel% neq 0 (
    echo ❌ Teste do Chrome falhou!
    echo 📋 Logs do container:
    docker logs whatsapp-api-prod --tail 30
    goto end
)

echo ✅ Teste do Chrome passou!

echo.
echo 7️⃣ Verificando logs do WhatsApp Bot...
echo 📋 Logs dos últimos 20 eventos:
docker logs whatsapp-api-prod --tail 20

echo.
echo 8️⃣ Testando API...
timeout /t 15 >nul

set /a attempts=0
:wait_api
set /a attempts+=1
if %attempts% gtr 10 (
    echo ❌ API não respondeu
    echo 📋 Logs completos:
    docker logs whatsapp-api-prod --tail 50
    goto end
)

powershell -Command "try { $response = Invoke-WebRequest -Uri 'http://localhost:3001/status' -UseBasicParsing; if ($response.StatusCode -eq 200) { exit 0 } else { exit 1 } } catch { exit 1 }"
if %errorlevel% neq 0 (
    echo ⏳ Tentativa %attempts%/10 - API ainda não disponível...
    timeout /t 10 >nul
    goto wait_api
)

echo ✅ API está funcionando!

echo.
echo 9️⃣ Status final:
powershell -Command "(Invoke-WebRequest -Uri 'http://localhost:3001/status' -UseBasicParsing).Content"

echo.
echo 🎉 TESTE CONCLUÍDO!
echo ==================
echo.
echo 🌐 Acesse: http://localhost:3001/qr.html
echo.

start http://localhost:3001/qr.html

:end
echo.
echo 📋 Comandos úteis:
echo ├─ Logs completos: docker logs whatsapp-api-prod -f
echo ├─ Teste Chrome: docker exec whatsapp-api-prod node test_chrome.js
echo ├─ Shell no container: docker exec -it whatsapp-api-prod sh
echo └─ Reiniciar: docker-compose restart whatsapp-api
echo.
pause
