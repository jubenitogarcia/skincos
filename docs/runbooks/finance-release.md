# Release, canary e recuperação do Financeiro

## Ordem obrigatória

1. No primeiro uso de staging, executar `deploy-finance.yml` com `bootstrap_service_secret=true`; nas execuções posteriores, manter esse campo como `false`. O Worker Financeiro deve existir antes de um gateway poder declarar sua service binding.
2. Depois, publicar somente o gateway pelo `deploy-core-workers.yml`, com `unit=api` e `bootstrap_finance_context=true`; isso instala a service binding e o segredo de contexto sem publicar Inventory. O smoke inicial do Worker usa `FINANCE_STAGING_WORKER_URL`; a verificação pelo gateway ocorre após este passo.
3. `deploy-finance.yml` em `preview` para o SHA de `main`.
4. `deploy-finance.yml` e `deploy-finance-ui.yml` em `staging`, ambos com o mesmo `release_sha` e `preview_run_id`. Cada migration Financeiro é importada junto ao seu registro em `d1_migrations`, de forma atômica; uma falha não deixa schema sem journal.
5. Conferir `health`, `readiness`, versão, dependências, logs estruturados, alertas e os artefatos `promotion-evidence-finance` e `promotion-evidence-finance-ui`.
6. Executar `finance-staging-canary.yml` somente depois do deploy de staging do mesmo SHA. O workflow é o único caminho que abre `canary`: ele exige a evidência do run de staging, aplica allowlist do ator sintético, coorte de unidade, percentual determinístico e SHA do Worker. O `module-availability.yml` não abre canary.
7. Para produção, usar o mesmo SHA e os dois `staging_run_id`; a aprovação do Environment é manual.

## Kill switch e manutenção

- `maintenance`: responde 503 somente para Financeiro, com `x-skincos-module-state=maintenance`.
- `disabled`: responde 423 somente para Financeiro; CRM, Inventory, Ponto e navegação continuam disponíveis.
- `canary`: exige simultaneamente allowlist, unidade, bucket percentual determinístico e SHA promovido; qualquer campo ausente falha fechado com 403/503. A política atual permite somente `finance-staging-monitor` em `novo-hamburgo` no staging.

## Canary sintético e limites automáticos

`ops/module-governance/finance-staging-canary-policy.json` é validado pelo CI e
declara os únicos ator e unidade permitidos, além dos limites para erros, p95 do
Financeiro, falha de autenticação, jornada, divergência de dados, auditoria e
dependências. A duração de login é registrada separadamente: não é usada no p95
do Worker Financeiro, mas uma falha de autenticação continua interrompendo a
promoção. O
workflow registra relatório sanitizado e decisão como artefato por 90 dias.

Ao exceder qualquer limite, o workflow grava `disabled` no KV, define
`module_enabled=false` antes de restaurar a baseline segura (`active` com a
feature desligada) e encerra com falha explícita. `mode=abort-drill` injeta uma
violação de métrica sem indisponibilizar dependências, para comprovar esse
caminho apenas em staging. Nenhuma dessas execuções altera produção, grants de
usuários reais ou a coorte de produção.

## Rollback e restore

1. Colocar Financeiro em `maintenance`.
2. Executar `deploy-finance.yml` com `operation=rollback` e o SHA anterior que possua evidência de staging. O pipeline seleciona a versão Worker já enviada para esse SHA; não recompila nem republica gateway, Inventory ou CRM Pages.
3. Executar `deploy-finance-ui.yml` com o mesmo SHA anterior se o bundle também precisar retornar; ele publica somente o projeto Pages Financeiro.
4. Se a correção exigir dados, baixar o checkpoint cifrado do workflow, restaurar primeiro em D1 isolado e comparar contagem/checksum lógico de `finance_audit_events`, `finance_movements`, `finance_journal_lines` e `finance_import_batches` por escopo.
5. Migrations são somente aditivas. Nunca apagar ledger, auditoria ou idempotência para “voltar”.
6. Reexecutar smoke de health/readiness e o fluxo piloto antes de tirar a manutenção.

## Replicação após evidência Financeiro

Ponto e Atendimento só recebem o padrão após existirem: um SHA Financeiro promovido até staging, um canary concluído, um rollback de Worker/UI e um restore isolado documentado. A replicação reutiliza: pipeline imutável, health/readiness, estado por KV/controle, checkpoint cifrado e verificação de isolamento de rota. Não copiar grants, bancos, secrets ou atores-piloto do Financeiro.
