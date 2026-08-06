# Operação comercial assistida do módulo Clientes

Este runtime organiza a fila comercial, a gestão da equipe e coortes congeladas. A tranche é deliberadamente assistida: não envia mensagens, não executa campanhas e mantém `commercialContactWritesEnabled=false`.

## Estado e pré-condições

- A migration `20260806_commercial_operations_v1` é aditiva e deve ser aplicada somente ao espelho local ou ao staging isolado.
- A aplicação falha com `COMMERCIAL_OPERATIONS_NOT_READY` até que a migration esteja registrada em `crm_atendimento.schema_migrations`.
- As rotas são GESTOR-only e honram o escopo de unidades do ator.
- Listas e métricas não retornam telefone/e-mail; a timeline usa apenas o schema explícito de eventos.

## Planejar e aplicar

```powershell
& .\scripts\invoke-skincos-wsl.ps1 -ProjectRoot (Get-Location).Path -WorkingDirectory crm/api -Executable npm -Argument @('run','migrate-commercial-operations','--','--plan')
```

Para o espelho local, configure apenas a variável privada `DATABASE_URL` para o socket permitido e execute:

```powershell
$env:ATENDIMENTO_MIGRATION_TARGET = 'local'
& .\scripts\invoke-skincos-wsl.ps1 -ProjectRoot (Get-Location).Path -WorkingDirectory crm/api -Executable npm -Argument @('run','migrate-commercial-operations','--','--apply')
```

O script rejeita TCP, hosts remotos, destinos fora de `local`/`staging` e argumentos extras. A role de runtime recebe DML/SELECT operacional e INSERT/SELECT dos ledgers; não recebe DDL.

## Operação diária

- `GET /commercial/operations`: carteira paginada por `limit`/`offset`, busca/status/responsável, flags de SLA, indicadores agregados, ausências e capacidades. A resposta sempre informa `wallet.total`, `hasPrevious` e `hasNext`; a UI não assume um limite silencioso.
- `GET /commercial/campaigns` e `GET /commercial/campaigns/:id`: coortes e membros sem PII de contato.
- `POST /commercial/campaigns/preview`: simulação obrigatória antes do congelamento.
- `POST /commercial/campaigns`: cria uma coorte versionada após nome, responsável, oferta opcional, justificativa e preview; a única ação externa é a escrita da própria coorte.
- `POST /commercial/team/rebalance`: primeiro execute com `apply=false`; só aplique a lista revisada com justificativa e chave idempotente.
- `PUT /commercial/owner-absences`: registra férias/ausência/licença antes do balanceamento.

Toda mutação assistida emitida por este workspace exige `idempotencyKey`, justificativa e, quando aplicável, `expectedRevision`. A aplicação usa lock do grafo, lock da linha e ledger append-only; replay da mesma chave devolve a resposta original e fingerprint divergente é conflito. Chamadas legadas sem esses campos permanecem compatíveis apenas para leitura/edição já existente e não habilitam campanhas ou balanceamento.

## Outcomes e Customer 360

Outcomes permitidos: `no_response`, `wrong_number`, `requested_follow_up`, `not_interested`, `completed_elsewhere`, `scheduled`, `attended`, `cancelled`, `sale`, `clinical_return` e `opt_out_requested`. O Customer 360 agrega Atendimento, Caixa, consentimento, ações, campanhas, decisões de identidade, qualidade e correções, expondo somente fonte, unidade, ator, timestamp e IDs de correlação seguros.

## Rollback e emergência

O rollback da migration é somente registral e não remove dados:

```powershell
$env:ATENDIMENTO_MIGRATION_TARGET = 'local'
& .\scripts\invoke-skincos-wsl.ps1 -ProjectRoot (Get-Location).Path -WorkingDirectory crm/api -Executable npm -Argument @('run','migrate-commercial-operations','--','--rollback')
```

Após rollback, as rotas de operações permanecem fail-closed. Para desligamento emergencial, mantenha o módulo em modo somente leitura pelo arquivo de controle/runtime existente; não habilite rollout de contato nem canário. Nenhuma ação de rollback apaga ações, campanhas ou evidências.

## Validação

1. Rode a suíte completa da API e os testes unitários de `commercialOperations.js`.
2. Rode typecheck/build do console e o smoke sintético com ator GESTOR.
3. Confirme que respostas de operações incluem `messagesEnabled=false`, `commercialContactWritesEnabled=false` e `privacy.phoneOrEmailInList=false`.
4. Confirme que replay, conflito de revisão, escopo cruzado e ausência de migration retornam erro controlado.
