# Staging (ambiente separado)

Objetivo: validar mudanças em um ambiente isolado antes de produção.

## Promotion path

1. Desenvolvimento local e PR curta.
2. Integração na `main` estável gera um candidato imutável.
3. O mesmo SHA/artefato é implantado em staging com bindings, secrets e flags de staging.
4. Smoke e evidência do artefato em staging são requisitos para uma promoção manual posterior.

A branch `staging` não é linha paralela de desenvolvimento e não autoriza deploy. Workflows legados que ainda a observam devem ser tratados como dívida de migração, não como caminho canônico.

Para reconstruir a fundação isolada de Identity, Inventory e Financeiro sem IDs ou arquivos locais privados, siga o [runbook de bootstrap e teardown](runbooks/staging-bootstrap-and-teardown.md). O estado gerado pelo Wrangler fica fora do repositório.

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
5. Health checks mínimos:
   - `/api/health`
   - `/api/escala/_proxy-status`

## Cloudflare Workers (Insumos)

1. Criar ambiente `staging` no Worker `skincos-insumos`.
2. Configurar bindings separados:
   - D1 staging (ex.: `skincos-db-staging`)
   - R2 staging (ex.: `skincos-backups-staging`)
3. Variáveis/segredos: replicar produção com valores de staging.
4. Rota recomendada: `api-staging.skincos.com.br/insumos/*`.
5. Smoke mínimo: `GET /health` e um fluxo de leitura real sem escrita destrutiva.

## Escala API

1. Manter `staging` habilitado em `workforce/schedule/wrangler.toml`.
2. Sincronizar `ESCALA_ACTOR_HMAC_KEY` para staging apenas pelo workflow de deploy correspondente.
3. Validar `/api/escala/health` e leitura de profissionais antes de promover o CRM que depende dessa API.

## GitHub Actions

- Pages (staging):
  - `vars.ENABLE_CRM_PAGES_DEPLOY_STAGING=true`
  - `vars.CLOUDFLARE_PAGES_PROJECT_STAGING=skincos-staging`
- Workers (staging):
  - `vars.ENABLE_INSUMOS_DEPLOY_STAGING=true`
  - `vars.INSUMOS_D1_DB_NAME_STAGING=skincos-db-staging`

## Critérios de aceite do staging

- Segredos e bindings separados de produção.
- Smoke automatizado passa antes de promoção.
- Nenhuma flag de bypass local habilitada.
- Logs e endpoints de health acessíveis.
- Inventário lógico validado em CI, sem IDs de recursos, URLs de Worker, dados ou valores de segredo no Git.
- `module_enabled=false` até uma aprovação de release específica do domínio.
