# Unit Monitor Gateway (LAN)

O gateway é o “servidor local” que roda dentro da rede das câmeras (RTSP) e expõe uma URL pública (via Cloudflare Tunnel) para o CRM online.

## Executar (manual)
1. Instale no gateway: `node`, `ffmpeg`/`ffprobe`, `mediamtx`, `cloudflared`.
2. Dentro do repo:
   - `npm --prefix backend/apps/crm-api install`
3. Rode:
   - `CLOUDFLARE_TUNNEL_TOKEN=... CRM_UNIT_MONITOR_PROXY_TOKEN=... CRM_API_PORT=8099 node backend/tools/unit-monitor-gateway/run.mjs`

O token `CRM_UNIT_MONITOR_PROXY_TOKEN` deve bater com `UNIT_MONITOR_PROXY_TOKEN` no Cloudflare Pages (CRM).

