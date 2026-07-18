# Migration local de segurança de escrita — Atendimento

## Escopo e proteção do destino

Migration: `20260718_atendimento_write_safety_v1`.

O executor é
`crm/api/scripts/migrate-atendimento-write-safety.mjs`. Ele aceita somente uma
`DATABASE_URL` que aponte para `skincos_crm_local` por loopback ou socket local,
e confirma o nome do banco e que a transação é gravável antes de qualquer DDL.
Não há caminho de execução para produção no script.

Aplicar localmente:

```bash
DATABASE_URL='postgresql:///skincos_crm_local?host=/var/run/postgresql' \
  node crm/api/scripts/migrate-atendimento-write-safety.mjs --apply
```

O launcher local do Atendimento executa o mesmo comando antes de iniciar o CRM.

## Alterações

- `attendances.value_formula_version`, `revision` e `idempotency_key`;
- campos de autoria, datas e exclusão lógica que o núcleo de escrita utiliza;
- campos de evento de auditoria (`actor`, `attendance_id`, `payload`,
  `created_at`) quando ausentes;
- constraints validadas `revision >= 1` e versão de fórmula não vazia;
- índice parcial único `(created_by, idempotency_key)` somente quando os dois
  valores existem;
- índices parciais para unidade/período, injetor/período,
  consultor/período e período ativo, além de evento por atendimento.

O SQL declarativo está em
`crm/api/server/atendimento/migrations/20260718_atendimento_write_safety_v1.up.sql`.
O executor usa o mesmo plano, adicionando batches e as verificações de destino.

## Compatibilidade histórica

Na primeira aplicação, linhas existentes recebem
`attendance-value/legacy-imported-v0` sem modificar `value`. Isso indica que o
valor veio do histórico e não deve ser recalculado silenciosamente. Novos
lançamentos recebem `attendance-value/v1` pelo backend. `revision` legada nula
vira `1`; `idempotency_key` nula permanece nula e não participa da unicidade.

O backfill é feito em lotes de 500 linhas. As constraints entram como `NOT
VALID` e depois são validadas; os índices são criados com `CONCURRENTLY`. O
executor tem `lock_timeout` de 3 segundos, `statement_timeout` de 60 segundos e
um advisory lock por migration. Assim uma disputa de lock falha cedo, sem ficar
aguardando indefinidamente.

## Evidência local de 2026-07-18

Banco autorizado: `skincos_crm_local` (socket local, usuário PostgreSQL local).

| Verificação | Resultado |
| --- | --- |
| Registros de Atendimento | 8.439 |
| Fórmulas históricas marcadas | 8.439 |
| Revisions legadas preenchidas | 8.439 |
| Valores financeiros recalculados | 0 |
| Chaves de idempotência legadas não nulas | 0 |
| Duplicidades de idempotência | 0 |
| Revisions/fórmulas inválidas depois | 0 |
| Reexecução da migration | sem alterações de dados |

Os seis índices previstos e as duas constraints foram encontrados no schema.
Em uma consulta por unidade, injetor e período, o planejador usou
`crm_atendimento_attendances_unit_injector_period_idx` (23 linhas, cerca de
7 ms no banco local). A tabela de auditoria ainda tinha somente 19 eventos; por
isso o planejador escolheu scan sequencial para uma consulta pouco seletiva,
apesar do índice existir. Reavaliar após crescimento real da tabela.

## Reversão

```bash
DATABASE_URL='postgresql:///skincos_crm_local?host=/var/run/postgresql' \
  node crm/api/scripts/migrate-atendimento-write-safety.mjs --rollback
```

A reversão é deliberadamente não destrutiva: remove apenas os índices e
constraints desta migration e registra `rolled_back_at`. Colunas, versões de
fórmula e eventos de auditoria permanecem, evitando perda de histórico e
permitindo reaplicação. Se for necessário remover colunas, isso exige uma
decisão de negócio e uma migration posterior específica, pois destrói
rastreabilidade.

## Decisão ainda pendente

Definir se fontes importadas futuras devem gravar uma versão explícita da
fórmula da fonte, em vez de herdar o default `attendance-value/v1`. A migration
atual não infere nem altera valores históricos.
