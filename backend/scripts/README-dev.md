# Dev scripts (unificados)

- backend/scripts/dev.sh
  - CLI único: start/stop/restart da stack e atalhos de E2E
  - Ex.: `./backend/scripts/dev.sh restart` ; `INSTANCES=1,2 ./backend/scripts/dev.sh restart` ; `./backend/scripts/dev.sh e2e smoke`
  - Atalhos de módulos: `./backend/scripts/dev.sh agent|sales-chart-messenger|scraper|sprinta|scheduled-posting|xiaomi-token|actual-server|crm`

- backend/scripts/dev.sh watch
  - Ponto único de entrada: mata portas comuns e inicia CRM API (watch), CRM Frontend (HMR) e WhatsApp (oficial por padrão; stub como fallback)
  - Env: CRM_PORT=5173 CRM_API_PORT=8099 INSTANCES=1,2 USE_OFFICIAL=1|0 (default auto)
  - Alias compat: `backend/scripts/dev-all-watch.sh`

- backend/scripts/e2e.sh (unified)
  - smoke: start real gateway instances (default INSTANCES=1,2) and run basic checks
    Example: ./backend/scripts/e2e.sh smoke  (INSTANCES=1,2)
  - ci-smoke: start mock servers and assert JSON shapes (used in CI)
    Example: ./backend/scripts/e2e.sh ci-smoke
  - health: repository health checks (non-failing)
    Example: ./backend/scripts/e2e.sh health

- Atalhos de automações/utilitários (via `dev.sh`):
  - Scraper: `./backend/scripts/dev.sh scraper all`
  - Sprinta: `./backend/scripts/dev.sh sprinta legacy ...` / `./backend/scripts/dev.sh sprinta v2 ...`
  - Scheduled Posting: `./backend/scripts/dev.sh scheduled-posting`
  - Xiaomi token: `./backend/scripts/dev.sh xiaomi-token`
  - Actual Server: `./backend/scripts/dev.sh actual-server start|menu`

- backend/scripts/status.sh
  - Mostra portas e health endpoints (best-effort)

- backend/scripts/test.sh
  - Runner simples para unit tests/compile/sanity

- backend/scripts/clean-local-artifacts.sh
  - Lista/remove artefatos locais regeneráveis (default `--dry-run`)

- backend/scripts/migrate-var.sh
  - Move estado local para `backend/var/` e cria symlinks (default `--dry-run`)

- backend/scripts/prune-sprinta-profiles.sh
  - Remove perfis Chrome temporários do Sprinta v2 (default `--dry-run`, mantém os 2 mais novos)

- backend/scripts/env.sh
  - Defaults compartilhados do workspace (`VAR_DIR`, `CONFIG_DIR`)

Docs úteis:
- `backend/docs/AGENT_ZERO.md`
- `backend/docs/NODE_PACKAGE_MANAGEMENT.md`
- `backend/docs/INDEX.md`

GitHub Actions
- .github/workflows/auto-next-steps.yml
  - On each push to main, creates an issue suggesting next steps based on changed paths.
  - It avoids paid models and notes how to enable GitHub Models free tiers if desired.
