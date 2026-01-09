@echo off
chcp 65001 >nul

echo 🔧 Teste Final - QR Code Visual
echo ================================
echo.

echo 1️⃣ Verificando QR Code disponível...
powershell -Command "try { $response = Invoke-WebRequest -Uri 'http://localhost:3001/qr' -UseBasicParsing; $data = $response.Content | ConvertFrom-Json; if ($data.success) { Write-Host '✅ QR Code disponível!' -ForegroundColor Green; Write-Host 'Dados:' $data.qr.Substring(0, 50) '...' } else { Write-Host '❌ QR Code não disponível' -ForegroundColor Red } } catch { Write-Host 'Erro:' $_.Exception.Message -ForegroundColor Red }"

echo.
echo 2️⃣ Testando páginas QR...
echo 📄 Página original: http://localhost:3001/qr.html
echo 📄 Página alternativa: http://localhost:3001/qr-simple.html

echo.
echo 3️⃣ Abrindo ambas as páginas para comparação...
start http://localhost:3001/qr.html
timeout /t 2 >nul
start http://localhost:3001/qr-simple.html

echo.
echo 🎉 TESTE CONCLUÍDO!
echo ==================
echo.
echo 💡 Instruções:
echo.
echo 📱 Se a página ORIGINAL ainda mostra texto:
echo    ├─ Abra o console do navegador (F12)
echo    ├─ Procure por erros JavaScript
echo    └─ Use a página alternativa
echo.
echo 📱 Se a página ALTERNATIVA funciona:
echo    ├─ Você deve ver o QR Code como imagem
echo    ├─ Escaneie com seu WhatsApp
echo    └─ Use esta página como principal
echo.
echo 🔧 Para fazer da alternativa a página principal:
echo    ├─ Renomeie /qr-simple.html para /qr-main.html
echo    └─ Atualize os links para apontar para a nova URL
echo.

pause
