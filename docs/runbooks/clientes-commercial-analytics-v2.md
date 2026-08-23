# Clientes Commercial Analytics v2

## Escopo e limites

Esta tranche cria uma projeção operacional de Analytics para Clientes. Ela mede qualidade, coortes, funil e experimentos; não é um mecanismo de contato. Todos os retornos de API incluem os controles abaixo e o Console os apresenta como modo de observação:

```json
{
  "commercialContactWritesEnabled": false,
  "messagesEnabled": false,
  "autonomousMessagingEnabled": false,
  "consentWritesEnabled": false
}
```

Não há rota de envio, dispatch, mensagem ou escrita de consentimento neste domínio. A existência de uma ação comercial, de uma coorte ou de um grupo treatment não autoriza comunicação.

## Modelo de dados e privacidade

A migration aditiva `20260807_commercial_analytics_v2` cria:

- `commercial_segment_definitions`, `commercial_segment_versions` e `commercial_segment_memberships` para critérios, revisões e snapshots imutáveis;
- `commercial_attribution_windows` para janelas versionadas;
- `commercial_experiments` e `commercial_experiment_assignments` para randomização persistida;
- `commercial_analytics_mutations` e `commercial_analytics_events` para idempotência e evidência append-only.

Os critérios de segmento usam exclusivamente a DSL snake_case abaixo. JSON arbitrário não é aceito:

`minimum_lifetime_sales`, `minimum_visits`, `minimum_recency_days`, `maximum_recency_days`, `minimum_lifetime_sales_percentile`, `minimum_visits_percentile`, `requires_permission`, `requires_phone_correlation`, `requires_fresh_sources`, `source_freshness_max_hours`, `identity_quality`, `procedure_ids`, `sales_classifications`.

O validador HTTP e a constraint PostgreSQL recusam camelCase, chaves desconhecidas, objetos aninhados e aliases de PII (telefone, e-mail, nome, CPF, endereço, contato, contexto, raw/evidence). Métricas, logs e UI retornam somente agregados, IDs opacos ou hashes; não retornam telefone, e-mail, nome do cliente ou payloads de fonte.

## Janela de atribuição e experimentos

Os defaults operacionais a configurar explicitamente em uma janela versionada são: resposta até 7 dias, agendamento até 14, comparecimento até 30, compra até 30 e retorno até 60. Sem uma janela persistida, o funil continua observável, mas `attributed` é `null` e não se pode alegar conversão atribuída.

Uma janela de atribuição sempre pertence a uma única unidade. Uma consulta de funil com `attributionWindowId` deve declarar exatamente essa unidade; uma consulta multiunidade é recusada com `COMMERCIAL_ANALYTICS_WINDOW_UNIT_SCOPE_REQUIRED`, em vez de reaproveitar uma janela local como se fosse global. A projeção de receita deduplica vendas quando uma identidade possui mais de um vínculo de origem Caixa.

Cada experimento exige um snapshot de segmento atual, uma janela ativa e uma unidade autorizada. A atribuição é determinística e persistida. Antes de qualquer decisão de assignment, Analytics obtém:

`commercial-experiment-crossover:<unit_id>:<identity_id>`

Esse é o mesmo advisory-lock namespace do Operations v2. Campaign create, action reassign e rebalance continuam verificando control/excluded sob esse lock; uma identidade com holdout ativo não pode sofrer crossover silencioso. Sobreposição com outro control/excluded é persistida como `excluded`, nunca convertida em tratamento. As assignments e seus ledgers são imutáveis.

O endpoint de métricas separa conversão observada, atribuída dentro da janela e incremental. Intervalo de confiança só é devolvido para ambos os braços com pelo menos 30 indivíduos; caso contrário, retorna `INSUFFICIENT_EXPERIMENT_SAMPLE`. Receita é limitada ao período do experimento e à janela de compra, não é atribuída indefinidamente.

## RBAC, escopo e readiness

As rotas `/api/atendimento/commercial/analytics/*` exigem o mesmo papel Clientes (`GESTOR`) da superfície comercial. O store também exige `GESTOR`/`ADMIN` e nunca transforma ausência de `allowedUnits` em escopo global. Para gestor limitado a unidade, Analytics calcula cobertura agregada apenas das unidades declaradas e omite as filas globais de quality/source operations, que ainda não possuem chave de unidade.

`GET /commercial/analytics/readiness` não faz mutação. Ela só retorna pronta quando as relações, os guards de update/delete/**truncate**, `SELECT` em `schema_migrations`, todos os grants de leitura/escrita mínimos (inclusive `USAGE` da sequence de eventos) e a migration aplicada estiverem presentes. Isso também satisfaz a dependência de readiness do guard de crossover em Operations.

## Migração, rollback e grants

O comando nativo aceita exclusivamente uma ação e o target local/staging:

```powershell
# apenas no boundary WSL aprovado; não use shell vindo de Environment/GitHub variable
npm run migrate-commercial-analytics -- --dry-run --target=staging
npm run migrate-commercial-analytics -- --apply --target=staging
npm run migrate-commercial-analytics -- --rollback --target=staging
```

Ele exige `DATABASE_URL` que passe pela verificação estrita de destino e não executa argumentos arbitrários. Apply e rollback abrem uma transação antes de obter o advisory lock de migration, portanto o lock e cada passo da mudança permanecem atômicos. A role de runtime recebe apenas `USAGE` de schema e `SELECT`/DML mínimo para as relações listadas, incluindo `SELECT crm_atendimento.schema_migrations`; não recebe DDL, DELETE ou TRUNCATE. A role de migration permanece separada.

Rollback é não destrutivo: marca o registry como rolled back e retém snapshots, assignments e evidência. Para rollback operacional, desabilite primeiro o experimento (se houver), registre o SHA predecessor, rode `--rollback` no mesmo target aprovado e valide readiness 503/fail-closed. Não remova tabelas nem dados de coorte.

## Operação e observabilidade

O Console exibe em **Clientes > Qualidade**:

- cobertura por unidade e freshness/fila global somente para ator global;
- histórico de findings, aging, reconhecimento, resolução, reabertura, ownership e SLA;
- funil observado versus atribuído;
- versões, snapshots, janelas e contagens de control/treatment/excluded.

Alertas devem usar o ledger existente de fontes: preventivo antes de 24h sem validação e finding alto a partir de 48h. Um snapshot incompleto, uma fonte stale ou ausência de readiness bloqueia qualquer snapshot/experiment mutation; nada deve ser aposentado ou excluído por ausência de fonte.

## Validação antes de promover

1. Rode API unit/route/migration tests e a matriz CI; valide que `schema_migrations` é selecionável pela role de runtime.
2. Em espelho local e staging isolado, execute dry-run, apply sintético, repetição da mesma idempotency key, revision conflict, snapshot, sobreposição control/excluded e rollback não destrutivo.
3. Confirme que Operations bloqueia create campaign, reassign e rebalance para control/excluded ativos no mesmo advisory-lock namespace.
4. Faça smoke autenticado com identidade sintética e confirme flags `false`; não envie mensagem, não abra escrita comercial e não altere consentimento.
