# Deployment Map (skincos)

Este documento é um “mapa operacional” do que está rodando em produção hoje (Cloudflare + serviços locais) e onde tendem a aparecer **drift**, **custo** e **falhas**.

## Superfícies de produção (Cloudflare)

### CRM independente
- Produto: **Cloudflare Pages + Worker** no repositório `jubenitogarcia/crm`
- Projeto: `skincos-crm-core`
- Domínio: `crm.skincos.com.br`
- Este monorepo não contém o bundle nem o publisher do CRM.

### Backend (Workers)

#### `skincos-api`
- Produto: **Cloudflare Worker**
- Route: `api.skincos.com.br/*`
- Código: `api`
- Nota importante: hoje ele compartilha implementação com `inventory/src` (qualquer mudança em `apps/insumos` afeta o `skincos-api`).

#### `skincos-insumos`
- Produto: **Cloudflare Worker**
- Route: `api.skincos.com.br/insumos/*` (mais específico, ganha precedência)
- Código: `inventory`

## Publicação canônica (GitHub → Cloudflare)

### Workers
- Workflow: `.github/workflows/deploy-core-workers.yml`
- É manual e seleciona `staging` ou `production`; não há publicação por `push`, reconciliação ou automerge.
- A unidade é deliberadamente conjunta: publica `skincos-api` e `skincos-insumos` para preservar o contrato compartilhado atual. Consultar `platform/deploy/operational-units.json` antes de criar outra via.

### Pages
- O publisher canônico do CRM está no repositório independente.
- Os publishers deste repositório são limitados às unidades listadas em `platform/deploy/operational-units.json`.

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
