# Unit Monitor (Smartcams)

Módulo do CRM para monitorar e gravar evidencias de cameras por unidade usando Google Home e screen recording (quando RTSP nao estiver disponivel). O objetivo e registrar clips locais com contexto operacional e manter configuracoes por unidade dentro do CRM.

## Visao geral
- Gravacao de tela (getDisplayMedia + MediaRecorder) com qualidade/codec configuraveis.
- Integracao Google Home via WebView (Electron) e deteccao de video no DOM.
- Favoritos por unidade com scripts de automacao (opcional).
- Suite de testes (compatibilidade, gravacao, Google Home, checklist e guias).
- Camadas RTSP/HLS (player, discovery e recording manager) para preparar futuro pipeline.
- Persistencia basica no backend com metadados de gravacao e configuracoes por unidade.

## Funcionalidades incorporadas
### Screen recording
- Qualidade: high/medium/low (1080p/720p/480p)
- Formatos: WebM ou MP4 (quando suportado)
- Auto-record: inicia quando video ativo e detectado
- Auto-stop: limite maximo de duracao
- Salvamento local (download no browser; pasta nativa em Electron)
- Logs detalhados de gravacao e chunks

### Google Home
- WebView automatizado (Electron) com navegacao back/forward/refresh
- Deteccao de login e player de video
- Favoritos com script de automacao (manual ou assistido)
- Status de video ativo para acionar auto-record

### Suite de testes e guias
- BrowserCompatibilityTest e BrowserCompatibilityGuide
- ScreenRecordingTest e CrossPlatformRecordingTest
- GoogleHomeTest, GoogleHomeCameraTest, GoogleHomeCameraRecordingTest
- RealWorldCameraTest (passos operacionais)
- TestingChecklist, TestSummary e TestingGuide
- CameraTestingGuide (passo a passo)

### RTSP/HLS (preparacao)
- RTSPPlayer (HLS.js) com fallback para streams de teste
- CameraDiscovery (simulacao de discovery, token e status)
- RecordingManager (simulacao de gravacao RTSP e historico)

## Como usar
1. Abra o modulo **Unit Monitor** no CRM.
2. Selecione a unidade (ex.: nh ou bss).
3. Abra o Google Home e navegue ate a camera desejada.
4. Clique em **Gravar** e selecione a janela/aba do Google Home.
5. Pare a gravacao; o arquivo fica local.
6. (Opcional) Salve configuracoes no servidor via **Salvar**.

## Requisitos tecnicos
- Browsers recomendados: Chrome/Edge (maior compatibilidade).
- Firefox: suporte parcial.
- Safari: limitacoes relevantes (screen capture pode nao funcionar).
- Permissoes: screen recording e acesso a arquivos (download/pasta).

## Troubleshooting (resumo)
- Permissao negada: verifique configuracoes de privacidade do browser/OS.
- Tela preta: tente gravar a tela inteira (nao apenas a aba).
- Auto-record nao inicia: verifique status “Video Active” no WebView.
- Arquivos grandes: reduza qualidade ou duracao.

## Privacidade e legal
- Grave apenas cameras com permissao explicita.
- As gravacoes permanecem localmente (sem upload automatico).
- Conformidade com legislacao local e responsabilidade do operador.

## Persistencia no backend
- Arquivo: `backend/var/core/unit_monitor.json`
- Contem configuracoes por unidade e metadados de gravacoes
- Campos relevantes em gravacoes: `filename`, `durationSeconds`, `sizeBytes`, `mimeType`, `savedPath`

## Endpoints
- `GET /api/unit-monitor/state?unit=<id>`: retorna config por unidade
- `PUT /api/unit-monitor/state?unit=<id>`: salva `{ config }`
- `POST /api/unit-monitor/recordings`: salva metadados de gravacao
- `GET /api/unit-monitor/recordings?unit=<id>`: lista metadados

## Limitacoes atuais
- Auto-record e automacao DOM dependem de Electron/WebView.
- RTSP/Discovery e RecordingManager ainda sao simulacoes (pipeline real nao incorporado).

## Docs adicionais
- `backend/docs/modules/crm/unit-monitor-readme.md`
- `backend/docs/modules/crm/unit-monitor-prd.md`
- `backend/docs/modules/crm/unit-monitor-browser-compatibility.md`
- `backend/docs/modules/crm/unit-monitor-testing-validation.md`

## Observacao sobre Electron
O projeto original contem wrapper Electron com preload expondo `window.electronAPI` e `window.googleHomeAPI`. O CRM usa essas APIs quando presentes, mas nao empacota o Electron neste momento. Referencia de codigo: `backend/tools/unit-monitor/electron-main.ts` e `backend/tools/unit-monitor/electron-preload.ts`.
