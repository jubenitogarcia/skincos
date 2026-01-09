@echo off
chcp 65001 >nul
title Cloudflare Tunnel - Docker Mode

echo 🐳 Configurando Tunnel com Docker
echo =================================
echo.

echo 📋 Verificando containers Docker...
docker ps --format "table {{.Names}}\t{{.Status}}"

echo.
echo 📋 Testando API Docker...
curl -s http://localhost:3001/status || echo ❌ API Docker não respondeu

echo.
echo 📋 Iniciando Cloudflare Tunnel para Docker...
echo 🔗 Domínio: https://wa.skincos.com.br
echo 🎯 Target: http://localhost:3001 (Docker)
echo.

cloudflared.exe tunnel --config cloudflare-config.yml run

pause
