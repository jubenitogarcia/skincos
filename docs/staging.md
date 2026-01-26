# Staging (ambiente separado)

Objetivo: validar mudanças em um ambiente isolado antes de produção.

## Cloudflare Pages (CRM)

1. Criar projeto Pages separado (ex.: `skincos-crm-staging`) apontando para este repo.
2. Configurar:
   - Root directory: `frontend`
   - Build command: `npm ci && npm run build`
   - Output: `dist`
3. Variáveis:
   - `VITE_NO_AUTH=false`
   - `INSUMOS_API_TARGET` apontando para o backend de staging (ex.: `https://api-staging.skincos.com.br`)
4. Vincular ao branch `staging` (ou usar o “Preview” do Pages).

## Cloudflare Workers (Insumos)

1. Criar ambiente `staging` no Worker `skincos-insumos`.
2. Configurar bindings separados:
   - D1 staging (novo database)
   - R2 staging (novo bucket)
3. Variáveis/segredos: replicar produção com valores de staging.
4. Rota recomendada: `api-staging.skincos.com.br/insumos/*`.

## GitHub Actions

- Usar `vars.ENABLE_CRM_PAGES_DEPLOY` e/ou `vars.ENABLE_INSUMOS_DEPLOY_STAGING` (se criado) para disparar deploys apenas no branch `staging`.
