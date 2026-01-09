@echo off
chcp 65001 >nul

echo 🔧 SCRIPT DE CORREÇÃO - Docker Deploy
echo =====================================
echo.

echo 🛑 1. PARANDO TODOS OS CONTAINERS...
docker stop $(docker ps -aq) 2>nul

echo 🗑️ 2. REMOVENDO CONTAINERS EXISTENTES...
docker rm $(docker ps -aq) 2>nul

echo 🧹 3. LIMPANDO REDES DOCKER...
docker network prune -f

echo 🔍 4. VERIFICANDO PORTAS EM USO...
echo Verificando porta 80:
netstat -ano | findstr :80
echo.
echo Verificando porta 443:
netstat -ano | findstr :443
echo.

echo ✅ 5. EXECUTANDO DEPLOY CORRIGIDO...
echo.
echo 📋 MUDANÇAS APLICADAS:
echo - Removido 'version' obsoleto do docker-compose.yml
echo - Porta 80 alterada para 8080 para evitar conflitos
echo - Porta 443 alterada para 8443 para evitar conflitos
echo.
echo 🌐 NOVA URL DE ACESSO:
echo http://localhost:8080 (HTTP)
echo https://localhost:8443 (HTTPS)
echo.

set /p continuar="Deseja continuar com o deploy? (S/N): "
if /i "%continuar%"=="S" (
    echo 🚀 Iniciando deploy...
    docker-compose up -d
) else (
    echo ❌ Deploy cancelado.
)

pause
