# Migracao Scraper -> Skincos (2026-03-10)

## Escopo migrado
- Codigo completo do projeto antigo `Automation/Scraper` para:
  - `integration/ef`
- Inclui:
  - runner (`run_scraper.py`)
  - modulo `espacofacial/*`
  - script utilitario `run_agenda_delta_all_units.sh`
  - docs, `.env.example`, testes e artefatos locais do modulo

## Ajustes aplicados apos copia
- `.codex/environments/environment.toml` (dentro do modulo scraper)
  - caminhos absolutos atualizados para o novo local em `skincos`

## Rotacao do token de sync

O rotador local de `AGENDA_SYNC_TOKEN` foi removido. A rotação e a atualização
do Worker devem ser coordenadas pelo publisher independente Website/Booking em
`jubenitogarcia/website`. Este registro histórico não atesta a configuração ou
a execução de uma rotação; o executor EF continua consumindo
`EF_AGENDA_SYNC_TOKEN`.

## Automations do Codex App
- Snapshot versionado no modulo:
  - `integration/ef/codex-automations/*.automation.toml`
- Automation ativa ajustada no Codex Home:
  - `~/.codex/automations/agenda-delta-00/automation.toml`
  - `cwds` atualizado para `.../skincos/integration/ef`

## Credenciais e configs sensiveis migradas (local, nao versionado)
- Base local:
  - `backend/var/scraper-migration/`
- Conteudo copiado:
  - `runtime-config/espacofacial/*` (agenda/login env)
  - `runtime-config/gh/*` (GitHub CLI config/hosts)
  - `runtime-config/cloudflare/*` (snapshot disponivel)
  - `scraper-repo/*` (snapshot de remote/branch/config do repo antigo)
  - `codex-automations/*` (snapshot completo local das automations)
  - `legacy-module-scraper-20260310/` (backup local do modulo scraper antigo do skincos)

## Validacao executada
- Import dos modulos principais:
  - `espacofacial`, `espacofacial.booking`, `espacofacial.booking_server`, `run_scraper`
- Smoke test de API local de booking:
  - `EF_MODE=booking_api EF_NON_INTERACTIVE=1 HEADLESS=1 ...`
  - `GET /healthz` respondeu `200`
