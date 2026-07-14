echo "Testando cloudflared..."
.\cloudflared.exe --version
echo "Iniciando tunnel..."
.\cloudflared.exe tunnel --config cloudflare-config.yml run
