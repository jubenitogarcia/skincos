# Release, canary e recuperação do Financeiro

## Ordem obrigatória

1. `deploy-finance.yml` em `preview` para o SHA de `main`.
2. `deploy-finance.yml` e `deploy-finance-ui.yml` em `staging`, ambos com o mesmo `release_sha` e `preview_run_id`.
3. Conferir `health`, `readiness`, logs estruturados, alertas e o artefato `promotion-evidence-finance`.
4. Ativar `canary` pelo `module-availability.yml` apenas para atores-piloto; manter `module_enabled=false` até os grants e dados de teste controlados estarem confirmados.
5. Para produção, usar o mesmo SHA e os dois `staging_run_id`; a aprovação do Environment é manual.

## Kill switch e manutenção

- `maintenance`: responde 503 somente para Financeiro, com `x-skincos-module-state=maintenance`.
- `disabled`: responde 423 somente para Financeiro; CRM, Inventory, Ponto e navegação continuam disponíveis.
- `canary`: só os atores explicitamente listados no controle podem alcançar a API; demais usuários recebem 403.

## Rollback e restore

1. Colocar Financeiro em `maintenance`.
2. Publicar pelo pipeline o SHA anterior que possua evidência de staging; não republicar gateway ou CRM Pages.
3. Se a correção exigir dados, baixar o checkpoint cifrado do workflow, restaurar primeiro em D1 isolado e comparar contagem/checksum lógico de `finance_audit_events`, `finance_movements`, `finance_journal_lines` e `finance_import_batches` por escopo.
4. Migrations são somente aditivas. Nunca apagar ledger, auditoria ou idempotência para “voltar”.
5. Reexecutar smoke de health/readiness e o fluxo piloto antes de tirar a manutenção.

## Replicação após evidência Financeiro

Ponto e Atendimento só recebem o padrão após existirem: um SHA Financeiro promovido até staging, um canary concluído, um rollback de Worker/UI e um restore isolado documentado. A replicação reutiliza: pipeline imutável, health/readiness, estado por KV/controle, checkpoint cifrado e verificação de isolamento de rota. Não copiar grants, bancos, secrets ou atores-piloto do Financeiro.
