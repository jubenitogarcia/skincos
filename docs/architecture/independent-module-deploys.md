# Deploy independente de módulos CRM

## Contrato operacional

O CRM continua um único Pages/shell visual. As rotas de domínio continuam atrás do gateway, mas Financeiro, Ponto e Atendimento possuem artefato/processo e pipeline próprios. Uma publicação, rollback ou manutenção do domínio não publica o Pages, Inventory ou os demais domínios.

| Módulo | Unidade operacional | Pipeline canônico | Controle sem deploy | Rollback |
| --- | --- | --- | --- | --- |
| Financeiro | Worker `skincos-finance` / `skincos-finance-staging` | `deploy-finance.yml` | KV `module-control:finance` | mesmo workflow, `operation=rollback` e SHA já promovido |
| Ponto | Worker `skincos-timekeeping` / `skincos-timekeeping-staging` | `deploy-timekeeping.yml` | KV `module-control:timekeeping` | versão Worker anterior + checkpoint D1; nunca republicar `api` |
| Atendimento | processo `CRM_DOMAIN=atendimento` | `deploy-atendimento.yml` | `atendimento-availability.yml` grava o arquivo indicado por `CRM_MODULE_CONTROL_FILE` | mesmo workflow com SHA anterior e comando de rollback dedicado |

O gateway somente transporta `/finance/*` e `/api/ponto/*`. Para Financeiro, ele resolve a sessão uma vez, remove cookie/CSRF do encaminhamento e entrega ao Worker apenas um contexto de ator HMAC de curta duração. Portanto o Worker financeiro não lê sessão, implementação de Identity ou D1 de Inventory.

## Ordem segura de ativação

1. Criar os dois Workers Financeiro, os dois D1s Financeiro e os dois KVs de controle, sem rota pública.
2. Configurar `FINANCE_SERVICE_AUTH_SECRET` idêntico apenas entre gateway e Financeiro **no mesmo ambiente**; nunca copiar secret de produção para staging.
3. Executar Financeiro em staging pelo SHA de `main`, aplicar migrations aditivas, smoke `/finance/health` e guardar a attestation.
4. Fazer a única publicação de bootstrap do gateway com a nova service binding `FINANCE`, depois promover o mesmo SHA Financeiro. Mudanças seguintes do Financeiro não publicam o gateway.
5. Configurar o unit/service dedicado do Atendimento, remover seu mount do processo CRM compartilhado e validar health por ambiente. Só então habilitar `ENABLE_ATENDIMENTO_DEPLOY=true`.

## Configuração externa mínima

- GitHub Environments `staging` e `production`: `FINANCE_D1_STAGING_ID`, `FINANCE_D1_PRODUCTION_ID`, `MODULE_CONTROL_STAGING_KV_ID`, `MODULE_CONTROL_PRODUCTION_KV_ID` e `FINANCE_SERVICE_AUTH_SECRET`, todos segregados.
- Cloudflare: criar `skincos-finance` e `skincos-finance-staging` antes do bootstrap do `api`; criar D1/KV separados por ambiente; conceder ao token somente Workers/D1/KV necessários.
- Runtime CRM: criar um unit de Atendimento independente, com porta/health próprios, `CRM_DOMAIN=atendimento`, `CRM_MODULE_CONTROL_FILE` privado e os comandos `CRM_ATENDIMENTO_DEPLOY_COMMAND`, `CRM_ATENDIMENTO_ROLLBACK_COMMAND`, `CRM_ATENDIMENTO_CONTROL_COMMAND`, `CRM_ATENDIMENTO_HEALTH_URL` configurados no Environment GitHub correspondente.
- Antes de produção: registrar a versão/commit de retorno, confirmar migration somente aditiva, executar smoke de staging do mesmo SHA e aprovar explicitamente o Environment de produção.

Nenhum dos workflows novos é acionado por push. Faltas de ID, secret, comando dedicado ou attestation falham explicitamente e não fazem deploy parcial.
