# Release e recuperação do Financeiro

## Escopo atual

O Financeiro neste monorepo é somente o Worker e seu D1 próprios. O console,
sessão e publicação Pages pertencem ao repositório independente do CRM e não
são construídos, publicados ou autenticados por este projeto.

Registros históricos de canário que dependiam do shell composto antigo foram
retirados junto com essa superfície. A validação atual é o smoke de Worker,
sem sessão, cookies, identidade sintética ou escrita em dados.

## Ordem obrigatória

1. No primeiro uso de staging, executar `deploy-finance.yml` com `bootstrap_service_secret=true`; nas execuções posteriores, manter esse campo como `false`. O Worker Financeiro deve existir antes de o gateway declarar sua service binding.
2. Depois, publicar somente o gateway pelo `deploy-core-workers.yml`, com `unit=api` e `bootstrap_finance_context=true`; isso instala a service binding e o segredo de contexto sem publicar Inventory.
3. Executar `deploy-finance.yml` em `preview` e depois em `staging` para o mesmo SHA imutável. Cada migration é aplicada junto ao seu registro em `d1_migrations`, de forma atômica.
4. Conferir `health`, `readiness`, versão, dependências, logs estruturados, alertas e o artefato `promotion-evidence-finance`.
5. Para produção, usar o mesmo SHA com o `staging_run_id` correspondente e a aprovação do Environment. O console independente do CRM não é publicado nem autenticado por este repositório.

## Kill switch e manutenção

- `maintenance`: responde 503 somente para Financeiro, com `x-skincos-module-state=maintenance`.
- `disabled`: responde 423 somente para Financeiro; os demais domínios e a navegação continuam disponíveis.
## Verificação

O `worker-release-smoke.mjs` é a verificação sintética sem sessão nem escrita:
confirma `health`, `readiness`, versão exata, D1, module-control e disponibilidade
ativa. Se qualquer limite de saúde falhar, o deploy permanece fechado. O
module-control continua podendo colocar o Worker em `maintenance` ou `disabled`
sem tocar no console independente, em grants ou em dados de outros domínios.

## Rollback e restore

1. Colocar Financeiro em `maintenance`.
2. Executar `deploy-finance.yml` com `operation=rollback` e o SHA anterior que possua evidência de staging. O pipeline seleciona a versão Worker já enviada para esse SHA; não recompila nem republica gateway, Inventory ou Ponto Pages.
3. Se a correção exigir dados, baixar o checkpoint cifrado do workflow, restaurar primeiro em D1 isolado e comparar contagem/checksum lógico de `finance_audit_events`, `finance_movements`, `finance_journal_lines` e `finance_import_batches` por escopo.
4. Migrations são somente aditivas. Nunca apagar ledger, auditoria ou idempotência para “voltar”.
5. Reexecutar o smoke de health/readiness antes de tirar a manutenção.
