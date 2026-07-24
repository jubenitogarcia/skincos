# Release, canary e recuperação do Financeiro

## Ordem obrigatória

1. No primeiro uso de staging, executar `deploy-finance.yml` com `bootstrap_service_secret=true`; nas execuções posteriores, manter esse campo como `false`. O Worker Financeiro deve existir antes de um gateway poder declarar sua service binding.
2. Depois, publicar somente o gateway pelo `deploy-core-workers.yml`, com `unit=api` e `bootstrap_finance_context=true`; isso instala a service binding e o segredo de contexto sem publicar Inventory. O smoke inicial do Worker usa `FINANCE_STAGING_WORKER_URL`; a verificação pelo gateway ocorre após este passo.
3. `deploy-finance.yml` em `preview` para o SHA de `main`.
4. `deploy-finance.yml` e `deploy-finance-ui.yml` em `staging`, ambos com o mesmo `release_sha` e `preview_run_id`.
5. Conferir `health`, `readiness`, versão, dependências, logs estruturados, alertas e os artefatos `promotion-evidence-finance` e `promotion-evidence-finance-ui`.
6. Ativar `canary` pelo `module-availability.yml` apenas para atores-piloto; manter `module_enabled=false` até os grants e dados de teste controlados estarem confirmados.
7. Para produção, usar o mesmo SHA e os dois `staging_run_id`; a aprovação do Environment é manual.

## Kill switch e manutenção

- `maintenance`: responde 503 somente para Financeiro, com `x-skincos-module-state=maintenance`.
- `disabled`: responde 423 somente para Financeiro; CRM, Inventory, Ponto e navegação continuam disponíveis.
- `canary`: só os atores explicitamente listados no controle podem alcançar a API; demais usuários recebem 403.

## Rollback e restore

1. Colocar Financeiro em `maintenance`.
2. Executar `deploy-finance.yml` com `operation=rollback` e o SHA anterior que possua evidência de staging. O pipeline seleciona a versão Worker já enviada para esse SHA; não recompila nem republica gateway, Inventory ou CRM Pages.
3. Executar `deploy-finance-ui.yml` com o mesmo SHA anterior se o bundle também precisar retornar; ele publica somente o projeto Pages Financeiro.
4. Se a correção exigir dados, baixar o checkpoint cifrado do workflow, restaurar primeiro em D1 isolado e comparar contagem/checksum lógico de `finance_audit_events`, `finance_movements`, `finance_journal_lines` e `finance_import_batches` por escopo.
5. Migrations são somente aditivas. Nunca apagar ledger, auditoria ou idempotência para “voltar”.
6. Reexecutar smoke de health/readiness e o fluxo piloto antes de tirar a manutenção.

## Replicação após evidência Financeiro

Ponto e Atendimento só recebem o padrão após existirem: um SHA Financeiro promovido até staging, um canary concluído, um rollback de Worker/UI e um restore isolado documentado. A replicação reutiliza: pipeline imutável, health/readiness, estado por KV/controle, checkpoint cifrado e verificação de isolamento de rota. Não copiar grants, bancos, secrets ou atores-piloto do Financeiro.
