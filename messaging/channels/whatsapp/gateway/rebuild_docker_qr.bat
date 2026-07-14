@echo off
chcp 65001 >nul

echo 🔄 Reconstruindo imagem Docker com páginas QR...
echo ===================================================

echo 1️⃣ Parando containers existentes...
docker-compose down

echo.
echo 2️⃣ Reconstruindo imagem...
docker-compose build --no-cache

echo.
echo 3️⃣ Iniciando containers...
docker-compose up -d

echo.
echo 4️⃣ Aguardando API ficar online...
timeout /t 10 >nul

echo.
echo 5️⃣ Testando página QR...
curl -s http://localhost:3001/qr.html | find "WhatsApp Bot" >nul
if %errorlevel% equ 0 (
    echo ✅ Página QR funcionando!
    echo.
    echo 🌐 URLs disponíveis:
    echo ├─ Página QR: http://localhost:3001/qr.html
    echo ├─ Status: http://localhost:3001/status
    echo └─ API: http://localhost:3001/
    echo.
    echo 💡 Abrindo página QR...
    start http://localhost:3001/qr.html
) else (
    echo ❌ Erro na página QR
    echo 📋 Verificando logs:
    docker logs whatsapp-api-prod --tail 10
)

echo.
pause
