@echo off
chcp 65001 >nul
title Cloudflare Tunnel - WhatsApp API

echo 🌐 Configurando Tunnel Cloudflare para WhatsApp API
echo ===================================================
echo.

echo 📋 Passo 1: Parando containers Docker...
docker-compose down >nul 2>&1

echo ✅ Containers parados!
echo.

echo 📋 Passo 2: Iniciando API WhatsApp local...
start "WhatsApp API Local" /min cmd /c "node bot_com_api.js"

echo ⏳ Aguardando API inicializar (10 segundos)...
timeout /t 10 /nobreak >nul

echo.
echo 📋 Passo 3: Testando API local...
curl -s http://localhost:3001/status || echo ❌ API não respondeu

echo.
echo 📋 Passo 4: Iniciando Cloudflare Tunnel...
echo 🔗 Domínio: https://wa.skincos.com.br
echo 🔧 Config: cloudflare-config.yml
echo.

cloudflared.exe tunnel --config cloudflare-config.yml run

echo.
echo ❌ Tunnel finalizado. Pressione qualquer tecla para sair.
pause >nul
