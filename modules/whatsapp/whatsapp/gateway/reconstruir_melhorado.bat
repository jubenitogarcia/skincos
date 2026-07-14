@echo off
echo ===========================================
echo    RECONSTRUINDO WHATSAPP COM MELHORIAS
echo ===========================================

echo.
echo 🔄 Parando containers atuais...
docker-compose down

echo.
echo 🗑️ Removendo imagem antiga...
docker rmi whatsapp-whatsapp-api 2>nul

echo.
echo 🔨 Reconstruindo com melhorias...
docker-compose build --no-cache

echo.
echo 🚀 Iniciando containers atualizados...
docker-compose up -d

echo.
echo 📊 Verificando status...
timeout /t 5 >nul
docker ps --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"

echo.
echo ✅ Reconstrução concluída!
echo.
echo 📋 Melhorias implementadas:
echo   - Redução de erros X11 e DBus
echo   - Melhor persistência da sessão
echo   - Inicialização mais estável
echo   - Permissões corrigidas
echo.
echo 🌐 Acesse: http://localhost:3001/qr.html
echo.
pause
