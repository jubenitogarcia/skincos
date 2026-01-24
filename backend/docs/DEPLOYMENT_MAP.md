# Deployment Map (skincos)

Este documento é um “mapa operacional” do que está rodando em produção hoje (Cloudflare + serviços locais) e onde tendem a aparecer **drift**, **custo** e **falhas**.

## Superfícies de produção (Cloudflare)

### Frontend (CRM)
- Produto: **Cloudflare Pages**
- Projeto: `skincos` (root_dir=`frontend`, build=`npm run build`, output=`dist`)
- Domínio: `crm.skincos.com.br`
- Observação: idealmente configure **build filters** do Pages como `path_includes=["frontend/**"]` para evitar rebuild/redeploy em commits que só mudam o backend.

### Backend (Workers)

#### `skincos-api`
- Produto: **Cloudflare Worker**
- Route: `api.skincos.com.br/*`
- Código: `backend/apps/api`
- Nota importante: hoje ele compartilha implementação com `backend/apps/insumos/src` (qualquer mudança em `apps/insumos` afeta o `skincos-api`).

#### `skincos-insumos`
- Produto: **Cloudflare Worker**
- Route: `api.skincos.com.br/insumos/*` (mais específico, ganha precedência)
- Código: `backend/apps/insumos`

## Auto-deploy (GitHub → Cloudflare)

### Workers
- Workflow: `.github/workflows/deploy-insumos-worker.yml`
- Dispara em `push` na `main` para mudanças em `backend/apps/api/**`, `backend/apps/insumos/**` e lockfiles do backend.
- Deploy “inteligente”: `backend/scripts/cloudflare-workers.sh` (deploy só do que mudou, considerando dependências).

### Pages
- Caminho recomendado: integração GitHub↔Pages (Cloudflare). O Pages já está conectado ao repo.
- Fallback opcional: `.github/workflows/deploy-crm-pages.yml` (wrangler), gated por `vars.ENABLE_CRM_PAGES_DEPLOY=true`.

## Onde normalmente você “deixa passar” (checklist rápido)

- **Código em produção fora do repo**: Workers criados/alterados no dashboard sem refletir no Git (causa drift e deploy inesperado).
- **Deploys duplicados**: Pages conectado ao GitHub + workflow via wrangler ao mesmo tempo (pode redeployar duas vezes).
- **Builds desnecessários**: Pages rebuildando em commits que só mudam backend (custos/tempo).
- **Segredos/vars sem fonte de verdade**: variáveis ajustadas no dashboard e ninguém lembra (quebra deploy/ambiente).
- **Rate limiting via Durable Object**: consome `rows_written` (se não “debounce/batch”).
- **Ambientes misturados**: produção/preview/dev compartilhando DB/buckets/secrets (risco alto).

## Próximas oportunidades (alto impacto)

- Criar `env.staging` (Workers e Pages) com DB/bucket/secrets separados.
- Migrar rate limiting de GET/read para **Cloudflare WAF Rate Limiting Rules** (elimina `rows_written` do DO para esse caso).
- Centralizar “source of truth” de configuração (schema de env + auditoria em CI).
- Observabilidade: Logpush / alertas (erros 5xx, rate-limited, D1 latency) e dashboards.

