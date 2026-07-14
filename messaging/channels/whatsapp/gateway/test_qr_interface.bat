@echo off
chcp 65001 >nul

echo 🔧 Teste da Interface QR Code Visual
echo ====================================
echo.

echo 📋 O que foi corrigido:
echo ├─ ✅ Biblioteca QRCode.js adicionada
echo ├─ ✅ QR Code visual gerado automaticamente
echo ├─ ✅ Fallback para texto se necessário
echo ├─ ✅ Toggle para mostrar/ocultar texto
echo └─ ✅ Design melhorado
echo.

echo 1️⃣ Verificando status da API...
powershell -Command "try { $response = Invoke-WebRequest -Uri 'http://localhost:3001/status' -UseBasicParsing; Write-Host 'API Status:' $response.StatusCode; if ($response.Content) { $response.Content } } catch { Write-Host 'Erro:' $_.Exception.Message }"

echo.
echo 2️⃣ Verificando endpoint QR...
powershell -Command "try { $response = Invoke-WebRequest -Uri 'http://localhost:3001/qr' -UseBasicParsing; Write-Host 'QR Endpoint:' $response.StatusCode; if ($response.Content) { $response.Content } } catch { Write-Host 'Erro:' $_.Exception.Message }"

echo.
echo 3️⃣ Verificando logs recentes do QR...
docker logs whatsapp-api-prod --tail 5 | findstr "QR Code"

echo.
echo 🎉 TESTE CONCLUÍDO!
echo ==================
echo.
echo 📱 Acesse a interface QR atualizada:
echo    http://localhost:3001/qr.html
echo.
echo 💡 O que você deve ver:
echo ├─ QR Code visual (imagem escaneável)
echo ├─ Botão para ver código texto
echo ├─ Atualização automática do QR
echo └─ Design melhorado
echo.

echo 🚀 Abrindo interface...
start http://localhost:3001/qr.html

echo.
echo 📋 Se o QR Code não aparecer:
echo ├─ Verifique se o console do navegador mostra erros
echo ├─ Aguarde alguns segundos para o QR ser gerado
echo ├─ Clique em "Atualizar Status"
echo └─ O código texto sempre estará disponível
echo.

pause
