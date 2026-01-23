# Unit Monitor Gateway (Edge / LAN)

Objetivo: rodar o **backend do Unit Monitor** em um computador dentro da **mesma rede LAN das câmeras** (RTSP) e expor uma **URL pública** (ex.: via Cloudflare Tunnel) para que o CRM online (Cloudflare Pages) consiga acessar `/api/unit-monitor/*`.

## Por que precisa de gateway
- Câmeras RTSP geralmente ficam em IPs privados (ex.: `192.168.x.x`) e **não são acessíveis** a partir do Cloudflare Pages/Workers.
- O gateway resolve isso conectando na LAN e servindo **HLS/WebRTC** e **gravação** via HTTP.

## Requisitos (na máquina gateway)
- Node.js (recomendado 18+)
- Binários no PATH: `ffmpeg`, `ffprobe`, `mediamtx`, `cloudflared`, `curl`
- Este repo clonado (ou ao menos `backend/` + `backend/apps/crm-api/`)

## Segurança (recomendado)
Use um segredo compartilhado entre Cloudflare Pages Function e o gateway:
- Cloudflare Pages (vars): `UNIT_MONITOR_PROXY_TOKEN=<segredo>`
- Gateway (env): `CRM_UNIT_MONITOR_PROXY_TOKEN=<segredo>`

Sem isso, qualquer pessoa que descobrir a URL do gateway pode tentar chamar os endpoints.

## Passo a passo (Cloudflare Tunnel + gateway)
1. Configure um Cloudflare Tunnel para publicar o serviço local:
   - Service/Origin: `http://localhost:8099`
   - Hostname: ex. `https://unit-monitor-gw.seudominio.com`
   - Pegue o token do tunnel (Zero Trust).

2. No gateway, instale dependências do módulo CRM API (uma vez):
   - `./backend/scripts/bootstrap.sh --module crm`

3. No gateway, suba API + streaming + tunnel:
   - `export CLOUDFLARE_TUNNEL_TOKEN="..."`
   - `export CRM_UNIT_MONITOR_PROXY_TOKEN="..."`
   - `node backend/tools/unit-monitor-gateway/run.mjs`
   - Alternativa (shell): `./backend/scripts/unit-monitor.sh gateway --crm-api-port 8099`

4. No Cloudflare Pages (CRM online), configure:
   - `UNIT_MONITOR_API_TARGET=https://unit-monitor-gw.seudominio.com`
   - `UNIT_MONITOR_PROXY_TOKEN=...` (o mesmo do gateway)

## Observação sobre WebRTC remoto
- Via tunnel HTTP, o **WebRTC pode falhar** em alguns ambientes (NAT/UDP). Se acontecer, use **HLS** no player do módulo.

## Checklist rápido
- `./backend/scripts/unit-monitor.sh check` (no gateway)
- `curl -fsS http://localhost:8099/health`
- `curl -fsS http://localhost:8099/api/unit-monitor/diagnostics`

## Instalador (cliente final)
- No CRM, o módulo **Unit Monitor** expõe downloads em:
  - `/downloads/unit-monitor-gateway-mac.command`
  - `/downloads/unit-monitor-gateway-windows.ps1`
- Esses instaladores perguntam os dados mínimos (token do tunnel, URL pública e proxy token), instalam dependências e iniciam o gateway.

### Auto-start (recomendado)
- macOS: o instalador oferece instalar um **LaunchAgent** para iniciar automaticamente ao logar.
  - Label: `com.skincos.unit-monitor-gateway`
  - Config/logs: `~/.skincos/unit-monitor-gateway/*`
- Windows: o instalador oferece criar um item no **Startup** (inicia automaticamente ao logar).
  - Arquivo: `%APPDATA%\\Microsoft\\Windows\\Start Menu\\Programs\\Startup\\skincos-unit-monitor-gateway.cmd`
  - Config/logs: `%USERPROFILE%\\.skincos\\unit-monitor-gateway\\*`

### Nota de segurança (tokens)
- O token do tunnel e o proxy token ficam salvos localmente para permitir auto-start.
- Recomendações:
  - use uma máquina dedicada (mini-PC) por unidade
  - restrinja acesso ao usuário do SO
  - revogue/rotacione tokens se houver suspeita de comprometimento
