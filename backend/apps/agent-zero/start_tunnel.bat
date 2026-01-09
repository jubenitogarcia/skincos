@echo off
cd "C:\Program Files (x86)\cloudflared"
cloudflared.exe tunnel run unified-tunnel
pause
