@echo off
chcp 65001 >nul

echo 🌐 TESTE RÁPIDO - Cloudflare Tunnel
echo ====================================
echo.

echo 🔍 Testando credenciais...
.\cloudflared.exe tunnel info d111123b-da44-45f1-adf1-35303be34865

echo.
echo 🚀 Iniciando túnel (Pressione Ctrl+C para parar)...
echo 🌐 URL: https://wa.skincos.com.br
echo.

.\cloudflared.exe tunnel --config cloudflare-config.yml run

pause
