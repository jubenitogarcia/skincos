# Unit Monitor (Smartcams)

Módulo do CRM para monitorar e gravar evidências de câmeras IP via **RTSP** por unidade, com **live (WebRTC/HLS via MediaMTX)** e **gravação server-side (ffmpeg)**. A configuração por unidade fica persistida no próprio CRM.

## Visao geral
- Configuração de câmeras RTSP por unidade (host/credenciais/path ou RTSP URL).
- Gateway de streaming: RTSP → HLS/WebRTC via MediaMTX (same-origin via `/api/unit-monitor/*`).
- Gravação server-side: RTSP → MP4 segmentado via ffmpeg (com histórico/retention).
- Persistência leve no backend via arquivo `backend/var/core/unit_monitor.json`.

## Funcionalidades incorporadas
### RTSP Live (MediaMTX)
- Start/stop do gateway via API.
- Player com WebRTC (preferido) e fallback HLS.

### Gravação RTSP (ffmpeg)
- Iniciar/parar gravação por câmera (segmentos MP4).
- Listagem de segmentos com playback/download.

## Como usar
1. Abra o modulo **Unit Monitor** no CRM.
2. Selecione a unidade (ex.: nh ou bss).
3. Cadastre as câmeras RTSP da unidade (host/usuário/senha/stream ou RTSP URL).
4. Clique em **Salvar** para persistir no servidor.
5. Clique em **Salvar e iniciar** para subir o gateway (MediaMTX).
6. Selecione uma câmera e acompanhe o **Live view**.
7. (Opcional) Inicie a **gravação server-side** para gerar segmentos.

## Como rodar (local)
- Subir CRM (frontend + API) focado no Unit Monitor:
  - `./backend/scripts/unit-monitor.sh dev`
- Diagnostico rapido (API):
  - `./backend/scripts/unit-monitor.sh diagnostics`

## Como usar (online / Cloudflare Pages)
- O CRM (frontend) pode estar online no Cloudflare Pages, mas o **Unit Monitor depende de um backend (crm-api) que consiga acessar as câmeras na LAN** (ex.: `192.168.x.x`).
- Configure no Cloudflare Pages (Environment Variables) a variável:
  - `UNIT_MONITOR_API_TARGET` → URL pública do `crm-api` (ex.: via Cloudflare Tunnel).
- Se `UNIT_MONITOR_API_TARGET` não estiver configurado (ou apontar para um host inválido), o módulo vai aparecer como **Servidor: offline**.

### Exemplo com Cloudflare Tunnel
1. Na máquina que está na mesma rede das câmeras, rode o backend:
   - `./backend/scripts/unit-monitor.sh api`
2. Exponha via tunnel:
   - `./backend/scripts/unit-monitor.sh tunnel --token <TOKEN>`
3. No Cloudflare Pages, aponte `UNIT_MONITOR_API_TARGET` para a URL pública do tunnel (ou seu domínio).

## Requisitos tecnicos
- Binários: `mediamtx`, `ffmpeg`, `ffprobe` no PATH (ou via env vars do CRM).
- Browser: Chrome/Edge recomendado (WebRTC/HLS).

## Troubleshooting (resumo)
- Sem imagem: confirme se o gateway está `RUNNING` e se a câmera está `enabled`.
- Teste RTSP: use o botão **Testar RTSP**; se falhar, revise host/credenciais/streamPath.
- Sem segmentos: inicie a gravação server-side e aguarde o primeiro arquivo.

## Privacidade e legal
- Grave apenas cameras com permissao explicita.
- As gravações ficam no storage do servidor (não há upload automático externo).
- Conformidade com legislacao local e responsabilidade do operador.

## Persistencia no backend
- Arquivo: `backend/var/core/unit_monitor.json`
- Contém configurações por unidade (câmeras + retenção)

## Endpoints
- `GET /api/unit-monitor/state?unit=<id>`: retorna config por unidade
- `PUT /api/unit-monitor/state?unit=<id>`: salva `{ config }`
- `GET /api/unit-monitor/streaming/status`: status do gateway + streams por câmera
- `POST /api/unit-monitor/streaming/start`: inicia MediaMTX
- `POST /api/unit-monitor/streaming/stop`: para MediaMTX
- `GET /api/unit-monitor/diagnostics`: diagnóstico (logs + disco)
- `POST /api/unit-monitor/rtsp/test`: testa RTSP via ffprobe
- `GET /api/unit-monitor/rtsp/recorders`: status dos recorders (ffmpeg)
- `POST /api/unit-monitor/rtsp/recorders/start`: inicia gravação por câmera
- `POST /api/unit-monitor/rtsp/recorders/stop`: para gravação por câmera
- `GET /api/unit-monitor/rtsp/recordings`: lista segmentos por câmera
- `GET /api/unit-monitor/rtsp/recordings/file`: serve playback/download do segmento

## Limitacoes atuais
- WebRTC pode falhar em alguns ambientes; use HLS como fallback.

## Docs adicionais
- `backend/docs/modules/crm/unit-monitor-prd.md`
