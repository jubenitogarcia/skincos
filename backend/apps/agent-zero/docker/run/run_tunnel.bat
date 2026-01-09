@echo off
cd "C:\Program Files (x86)\cloudflared"
cloudflared.exe tunnel --config "C:\Automation\Agent Zero\a0\docker\run\config.yml" run 905c9281-870e-4f2b-a6e6-7918879c81d5
pause
