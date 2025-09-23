# Dev scripts (unificados)

- scripts/dev-all-watch.sh
  - Ponto único de entrada: mata portas comuns e inicia CRM API (watch), CRM Frontend (HMR) e WhatsApp (oficial por padrão; stub como fallback)
  - Env: CRM_PORT=5173 CRM_API_PORT=3100 GW_INSTANCE=1 USE_OFFICIAL=1|0 (default auto)

- scripts/e2e.sh (unified)
  - smoke: start real gateway instances (default INSTANCES=1,2) and run basic checks
    Example: ./scripts/e2e.sh smoke  (INSTANCES=1,2)
  - ci-smoke: start mock servers and assert JSON shapes (used in CI)
    Example: ./scripts/e2e.sh ci-smoke
  - health: repository health checks (non-failing)
    Example: ./scripts/e2e.sh health

- scripts/e2e-multi-instance-smoke.sh (delegates to e2e.sh smoke)

GitHub Actions
- .github/workflows/auto-next-steps.yml
  - On each push to main, creates an issue suggesting next steps based on changed paths.
  - It avoids paid models and notes how to enable GitHub Models free tiers if desired.
