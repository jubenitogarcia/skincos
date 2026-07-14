@echo off
echo 🚀 Iniciando Infraestrutura Completa WhatsApp (Windows)
echo ===============================================

:: Verificar se Docker está rodando
echo [INFO] Verificando Docker...
docker info >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] Docker não está rodando. Inicie o Docker Desktop primeiro.
    pause
    exit /b 1
)
echo [SUCCESS] Docker está ativo

:: Parar containers existentes
echo [INFO] Parando containers existentes...
docker-compose -f docker-compose.production.yml down --remove-orphans 2>nul

:: Limpar sistema Docker
echo [INFO] Limpando sistema Docker...
docker system prune -f

:: Criar redes necessárias
echo [INFO] Criando redes Docker...
docker network create whatsapp-network 2>nul

:: Copiar configuração do Nginx
echo [INFO] Configurando Nginx...
copy nginx.production.conf nginx.conf >nul

:: Build da imagem principal
echo [INFO] Construindo imagem WhatsApp API...
docker-compose -f docker-compose.production.yml build whatsapp-api

if %errorlevel% neq 0 (
    echo [ERROR] Falha no build da imagem WhatsApp API
    pause
    exit /b 1
)

echo [SUCCESS] Imagem construída com sucesso

:: Iniciar todos os serviços
echo [INFO] Iniciando todos os serviços...
docker-compose -f docker-compose.production.yml up -d

:: Aguardar inicialização
echo [INFO] Aguardando inicialização dos serviços (60 segundos)...
timeout /t 60 /nobreak >nul

:: Verificar status dos containers
echo [INFO] Verificando status dos containers...
docker-compose -f docker-compose.production.yml ps

:: Verificar logs da API
echo [INFO] Verificando logs da API WhatsApp...
docker-compose -f docker-compose.production.yml logs --tail=20 whatsapp-api

echo.
echo ================================================
echo 🎉 INFRAESTRUTURA WHATSAPP INICIADA COM SUCESSO
echo ================================================
echo.
echo 📍 Serviços Disponíveis:
echo    • WhatsApp API:      http://localhost:3001
echo    • QR Code:           http://localhost:3001/qr
echo    • API Status:        http://localhost:3001/status
echo    • Traefik Dashboard: http://localhost:8080
echo    • Nginx Files:       http://localhost:8090
echo    • Portainer:         http://localhost:9000
echo    • Redis:             localhost:6379
echo.
echo 🔧 Comandos Úteis:
echo    • Ver logs API:      docker-compose -f docker-compose.production.yml logs -f whatsapp-api
echo    • Reiniciar API:     docker-compose -f docker-compose.production.yml restart whatsapp-api
echo    • Parar tudo:        docker-compose -f docker-compose.production.yml down
echo    • Status geral:      docker-compose -f docker-compose.production.yml ps
echo.
echo 📱 Para conectar WhatsApp:
echo    1. Acesse: http://localhost:3001/qr
echo    2. Escaneie o QR Code com seu WhatsApp
echo    3. Aguarde a mensagem 'Client is ready'
echo.
echo ✅ Infraestrutura pronta para uso!
echo.
pause
