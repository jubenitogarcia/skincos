@echo off
chcp 65001 >nul

echo 🔧 Rebuild Final - Correção de Permissões e Puppeteer
echo ======================================================
echo.

echo 📋 Aplicando correções para:
echo ├─ ❌ Erro de permissão (chmod)
echo ├─ ❌ Erro de sessão fechada (setUserAgentOverride)
echo ├─ ✅ Simplificação dos argumentos do Puppeteer
echo ├─ ✅ Aumento das tentativas de inicialização
echo └─ ✅ Permissões de diretório corrigidas no Dockerfile
echo.

echo 1️⃣ Parando e removendo containers...
docker-compose down --remove-orphans

echo.
echo 2️⃣ Limpando volumes e cache...
docker system prune -af
docker volume rm whatsapp_whatsapp_auth whatsapp_whatsapp_cache whatsapp_chrome_profiles whatsapp_whatsapp_runtime 2>nul

echo.
echo 3️⃣ Reconstruindo a imagem do zero...
docker-compose build --no-cache

echo.
echo 4️⃣ Iniciando os serviços...
docker-compose up -d

echo.
echo 5️⃣ Monitorando a inicialização (aguardando até 3 minutos)...
timeout /t 20 >nul

echo.
echo 📋 Verificando logs de inicialização:
docker logs whatsapp-api-prod --tail 25

echo.
echo 6️⃣ Testando a API...
set /a attempts=0
:wait_api
set /a attempts+=1
if %attempts% gtr 20 (
    echo ❌ API não respondeu após várias tentativas.
    echo 📋 Logs completos:
    docker logs whatsapp-api-prod --tail 50
    goto end
)

powershell -Command "try { $response = Invoke-WebRequest -Uri 'http://localhost:3001/status' -UseBasicParsing; if ($response.StatusCode -eq 200) { exit 0 } else { exit 1 } } catch { exit 1 }"
if %errorlevel% neq 0 (
    echo ⏳ Tentativa %attempts%/20 - Aguardando API ficar online...
    timeout /t 10 >nul
    goto wait_api
)

echo ✅ API está online!

echo.
echo 7️⃣ Verificação final do status do bot...
echo 📊 Status JSON:
powershell -Command "(Invoke-WebRequest -Uri 'http://localhost:3001/status' -UseBasicParsing).Content"

echo.
echo 🎉 REBUILD CONCLUÍDO!
echo =====================
echo.
echo 🌐 Acesse a interface do QR Code para conectar:
echo    http://localhost:3001/qr.html
echo.
echo 💡 Abrindo a página no seu navegador...
start http://localhost:3001/qr.html

echo.
echo 📋 Comandos úteis para monitoramento:
echo ├─ Ver logs em tempo real: docker logs whatsapp-api-prod -f
echo ├─ Ver status dos containers: docker-compose ps
echo.

:end
pause
