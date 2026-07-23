# Pipelines canônicos de deploy

Status: ativo em 2026-07-23. Esta decisão complementa a [política operacional de mudanças](operational-change-policy.md).

Cada unidade abaixo tem exatamente um workflow GitHub Actions autorizado a criar uma nova versão, aplicar migration remota ou alterar segredo que gere nova versão. Qualquer novo workflow deve ser somente leitura ou ser adicionado a esta tabela e ao validador de arquitetura na mesma PR.

| Unidade operacional | Ambiente | Pipeline canônico | Ordem e bloqueios |
| --- | --- | --- | --- |
| API gateway e Inventory | staging / produção | `.github/workflows/deploy-insumos-worker.yml` | Serializado por ambiente. Finance fica bloqueado em produção sem `ENABLE_FINANCE_PRODUCTION_DEPLOY=true`; migrações Finance são apenas staging. |
| CRM Pages | staging / produção | `.github/workflows/deploy-crm-pages.yml` | Serializado por ambiente. Sincroniza somente os segredos de proxy necessários e falha se estiverem ausentes; Meta Ads Report não é incluído. |
| Timekeeping | staging / produção | `.github/workflows/deploy-timekeeping.yml` | Produção exige atestação da execução staging no mesmo SHA. Publica apenas o Worker de Timekeeping; qualquer mudança no gateway API deve ser liberada antes pelo pipeline Core. |
| Escala API | staging / produção | `.github/workflows/deploy-escala-api.yml` | Cada execução escolhe exatamente um ambiente, aplica migrations antes do Worker e executa smoke no mesmo ambiente. |
| Social Publisher | produção | `.github/workflows/deploy-social-publisher-worker.yml` | Exige `ENABLE_SOCIAL_PUBLISHER_DEPLOY=true`; segredos só mudam neste fluxo. |
| Meta Ads Report Worker | produção | `.github/workflows/deploy-meta-ads-report-worker.yml` | Manual, sem gatilho por push; requer confirmação `release_authorized=true` e `ENABLE_META_ADS_REPORT_WORKER_DEPLOY=true`. |
| Website, hub legal, `esfa.co` e D1 de redirects | produção | `.github/workflows/deploy-website-cloudflare.yml` | Uma fila serializada; erros de secret sync interrompem a release antes dos deploys. |
| CRM API nativo | produção | procedimento `docs/runtime-native-cutover-runbook.md` | Não possui workflow GitHub Actions; a promoção nativa é a única via e deve ter checkpoint e rollback. |

## Regras de implementação

- `concurrency` é por unidade e ambiente, com `cancel-in-progress: false`: a execução mais nova espera a anterior, preservando ordem e rollback observável. Todo pipeline canônico declara o GitHub Environment correspondente; proteção/aprovação de `production` deve permanecer habilitada no repositório.
- O workflow deve falhar com `::error::` quando flag, credencial, segredo ou atestação exigida estiver ausente. Não é permitido trocar essa condição por `skip` silencioso.
- Staging e produção nunca podem ser alterados na mesma execução. O único encadeamento permitido é evidência de staging anexada à execução posterior de produção.
- Migrations são aditivas e aplicadas antes do código dependente, no banco do ambiente selecionado. Rollback é por flag/versão de Worker ou Pages; schema novo permanece compatível até uma migration posterior e planejada.
- Reconciliadores agendados, dispatches pós-merge e sincronizadores independentes de segredo não podem publicar. O validador `.github/scripts/validate-canonical-deploy-workflows.mjs` bloqueia essas rotas em PR e `main`.
