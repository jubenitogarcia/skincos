# Migracao Scraper -> Skincos (2026-03-10)

## Escopo migrado
- Codigo completo do projeto antigo `Automation/Scraper` para:
  - `integration/ef`
- Inclui:
  - runner (`run_scraper.py`)
  - modulo `espacofacial/*`
  - docs, `.env.example`, testes e artefatos locais do modulo

## Ajustes aplicados apos copia
- `.codex/environments/environment.toml` (dentro do modulo scraper)
  - caminhos absolutos atualizados para o novo local em `skincos`

## Rotacao do token de sync

O rotador local de `AGENDA_SYNC_TOKEN` foi removido. A rotação e a atualização
do Worker devem ser coordenadas pelo publisher independente Website/Booking em
`jubenitogarcia/website`. Este registro histórico não atesta a configuração ou
a execução de uma rotação. O nome `EF_AGENDA_SYNC_TOKEN` permanece como
contrato de cliente para integrações EF externas; este monorepo não contém
mais o transporte que o consumia.

## Automations do Codex App

A definição versionada da automação Website/Booking de agenda-delta foi retirada deste monorepo junto com a fonte/publicador. Este registro não afirma o estado de automations privadas no Codex Home.

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

## Validacao historica

Na época da migração foram validados os imports do runner EF e o listener local de Booking. O listener, executor privado e seus testes foram posteriormente retirados deste monorepo; a fonte e o publisher agora pertencem a `jubenitogarcia/website`. Esta mudança de ownership preserva os contratos públicos e não afirma migração do runtime Cloudflare nem dos dados.
