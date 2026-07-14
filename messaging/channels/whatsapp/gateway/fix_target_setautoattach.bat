@echo off
chcp 65001 >nul

echo 🔧 Correção Final - Target.setAutoAttach Error
echo ===============================================
echo.

echo 📋 Aplicando correção específica para:
echo ├─ ❌ Protocol error (Target.setAutoAttach)
echo ├─ ✅ Configurações Puppeteer otimizadas
echo ├─ ✅ DevTools desabilitado
echo └─ ✅ Pipe mode habilitado
echo.

echo 1️⃣ Reiniciando container com nova configuração...
docker-compose restart whatsapp-api

echo.
echo 2️⃣ Aguardando reinicialização...
timeout /t 20 >nul

echo.
echo 3️⃣ Verificando logs de inicialização:
docker logs whatsapp-api-prod --tail 15

echo.
echo 4️⃣ Testando API...
set /a attempts=0
:wait_api
set /a attempts+=1
if %attempts% gtr 15 (
    echo ❌ API não respondeu adequadamente
    echo 📋 Logs completos:
    docker logs whatsapp-api-prod --tail 50
    goto end
)

powershell -Command "try { $response = Invoke-WebRequest -Uri 'http://localhost:3001/status' -UseBasicParsing; $response.StatusCode } catch { 0 }" | findstr "200" >nul 2>&1
if %errorlevel% neq 0 (
    echo ⏳ Tentativa %attempts%/15 - Aguardando API...
    timeout /t 10 >nul
    goto wait_api
)

echo ✅ API respondendo!

echo.
echo 5️⃣ Verificando status do WhatsApp...
echo 📊 Status JSON:
powershell -Command "try { (Invoke-WebRequest -Uri 'http://localhost:3001/status' -UseBasicParsing).Content } catch { 'Erro ao acessar API' }"

echo.
echo 🎉 CORREÇÃO APLICADA!
echo ====================
echo.
echo 🌐 URLs para testar:
echo ├─ Status: http://localhost:3001/status
echo ├─ QR Code: http://localhost:3001/qr.html
echo └─ Documentação: http://localhost:3001/
echo.

echo 💡 Abrindo interface QR...
start http://localhost:3001/qr.html

echo.
echo 📋 Monitoramento:
echo ├─ Logs em tempo real: docker logs whatsapp-api-prod -f
echo ├─ Status containers: docker-compose ps
echo └─ Reiniciar se necessário: docker-compose restart
echo.

:end
pause
