# Deploy independente de módulos CRM

## Contrato operacional

O CRM continua um único Pages/shell visual. As rotas de domínio continuam atrás do gateway, mas Financeiro, Ponto e Atendimento possuem artefato/processo e pipeline próprios. Uma publicação, rollback ou manutenção do domínio não publica o Pages, Inventory ou os demais domínios.

| Módulo | Unidade operacional | Pipeline canônico | Controle sem deploy | Rollback |
| --- | --- | --- | --- | --- |
| Financeiro API | Worker `skincos-finance` / `skincos-finance-staging` | `deploy-finance.yml` | KV `module-control:finance` | `versions deploy` de versão já enviada para o SHA promovido |
| Financeiro UI | Pages `FINANCE_UI_PAGES_PROJECT_*` | `deploy-finance-ui.yml` | URL estável `VITE_FINANCE_MODULE_URL` no shell | publicar o SHA já promovido pelo mesmo pipeline |
| Ponto | Worker `skincos-timekeeping` / `skincos-timekeeping-staging` | `deploy-timekeeping.yml` | KV `module-control:timekeeping` | versão Worker anterior + checkpoint D1; nunca republicar `api` |
| Atendimento | processo `CRM_DOMAIN=atendimento` | `deploy-atendimento.yml` | `atendimento-availability.yml` grava o arquivo indicado por `CRM_MODULE_CONTROL_FILE` | mesmo workflow com SHA anterior e comando de rollback dedicado |

O gateway somente transporta `/finance/*` e `/api/ponto/*`. Para Financeiro, ele resolve a sessão uma vez, valida CSRF, remove cookie/CSRF do encaminhamento e entrega ao Worker apenas um contexto de ator HMAC de curta duração. Os probes públicos `/finance/health` e `/finance/readiness` são somente encaminhados, sem ator. Portanto o Worker financeiro não lê sessão, implementação de Identity ou D1 de Inventory; disponibilidade, canary, escopos e regras financeiras pertencem ao domínio Financeiro.

## Ordem segura de ativação

1. Criar os dois Workers Financeiro, os dois D1s Financeiro, os dois KVs de controle e os dois projetos Pages de UI, sem rota pública.
2. Configurar `FINANCE_SERVICE_AUTH_SECRET` idêntico apenas entre gateway e Financeiro **no mesmo ambiente**; nunca copiar secret de produção para staging.
3. Executar o preview imutável, depois Financeiro API e UI em staging pelo mesmo SHA de `main`; o pipeline exporta e cifra checkpoint D1, aplica somente migrations aditivas, smoke `/finance/health` e guarda a evidência de promoção.
4. Fazer uma única publicação de bootstrap do gateway pelo pipeline canônico `deploy-core-workers.yml`, selecionando `unit=api` e `bootstrap_finance_context=true`, com a nova service binding `FINANCE`; no mesmo estágio, executar o primeiro `deploy-finance.yml` com `bootstrap_service_secret=true`. Publicar o shell uma única vez com `VITE_FINANCE_MODULE_URL`. Mudanças seguintes do Financeiro não publicam gateway, Inventory ou CRM Pages.
5. Configurar o unit/service dedicado do Atendimento, remover seu mount do processo CRM compartilhado e validar health por ambiente. Só então habilitar `ENABLE_ATENDIMENTO_DEPLOY=true`.

## Configuração externa mínima

- GitHub Environments `staging` e `production`: `FINANCE_D1_STAGING_ID`, `FINANCE_D1_PRODUCTION_ID`, `FINANCE_CONTROL_STAGING_KV_ID`, `FINANCE_CONTROL_PRODUCTION_KV_ID`, `FINANCE_UI_PAGES_PROJECT_STAGING`, `FINANCE_UI_PAGES_PROJECT_PRODUCTION`, `FINANCE_SERVICE_AUTH_SECRET` e `FINANCE_BACKUP_PASSPHRASE`, todos segregados.
- Cloudflare: criar `skincos-finance` e `skincos-finance-staging` antes do bootstrap do `api`; criar D1/KV separados por ambiente; conceder ao token somente Workers/D1/KV necessários.
- CRM Pages: definir `FINANCE_UI_MODULE_URL` no Environment GitHub para a URL estável `https://skincos-finance-ui-staging.pages.dev/finance-module.js` em staging (e o equivalente produtivo apenas após aprovação). O pipeline canônico de Pages injeta esse valor no build; sem ele, ou se o bundle falhar, o shell exibe apenas o estado isolado de indisponibilidade — nunca uma cópia local das regras financeiras.
- Runtime CRM: criar um unit de Atendimento independente, com porta/health próprios, `CRM_DOMAIN=atendimento`, `CRM_MODULE_CONTROL_FILE` privado e os comandos `CRM_ATENDIMENTO_DEPLOY_COMMAND`, `CRM_ATENDIMENTO_ROLLBACK_COMMAND`, `CRM_ATENDIMENTO_CONTROL_COMMAND`, `CRM_ATENDIMENTO_HEALTH_URL` configurados no Environment GitHub correspondente.
- Antes de produção: registrar a versão/commit de retorno, confirmar migration somente aditiva, executar smoke de staging do mesmo SHA e aprovar explicitamente o Environment de produção.

Canary é deliberadamente por ator-piloto explícito no KV, não por porcentagem aleatória: o workflow `module-availability.yml` exige `state=canary` e a lista de atores. `maintenance` e `disabled` não publicam artefato. O rollback de código só aceita SHA já promovido; dados não sofrem rollback destrutivo — o checkpoint cifrado é restaurado antes em ambiente isolado e comparado com razão, auditoria, movimentos e lotes.

Nenhum dos workflows novos é acionado por push. Faltas de ID, secret, comando dedicado, checkpoint ou evidência de promoção falham explicitamente e não fazem deploy parcial. O rollback do Worker não recompila nem publica outro módulo: seleciona a versão já associada ao SHA de retorno. O rollback da UI republica somente o bundle construído do SHA previamente promovido, no projeto Pages isolado.
