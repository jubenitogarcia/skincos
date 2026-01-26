# Staging (ambiente separado)

Objetivo: validar mudanças em um ambiente isolado antes de produção.

## Cloudflare Pages (CRM)

1. Criar projeto Pages separado (ex.: `skincos-staging`) apontando para este repo.
2. Configurar:
   - Root directory: `frontend`
   - Build command: `npm ci && npm run build`
   - Output: `dist`
3. Variáveis:
   - `INSUMOS_API_TARGET=https://api-staging.skincos.com.br`
   - `REQUIRE_INTEGRATIONS_ENCRYPTION_SECRET=true`
   - `R2_KEY_PREFIX=staging/`
4. Vincular ao branch `staging`.

## Cloudflare Workers (Insumos)

1. Criar ambiente `staging` no Worker `skincos-insumos`.
2. Configurar bindings separados:
   - D1 staging (ex.: `skincos-db-staging`)
   - R2 staging (ex.: `skincos-backups-staging`)
3. Variáveis/segredos: replicar produção com valores de staging.
4. Rota recomendada: `api-staging.skincos.com.br/insumos/*`.

## GitHub Actions

- Pages (staging):
  - `vars.ENABLE_CRM_PAGES_DEPLOY_STAGING=true`
  - `vars.CLOUDFLARE_PAGES_PROJECT_STAGING=skincos-staging`
- Workers (staging):
  - `vars.ENABLE_INSUMOS_DEPLOY_STAGING=true`
  - `vars.INSUMOS_D1_DB_NAME_STAGING=skincos-db-staging`
