# Materialização de identidade de Atendimento para CRM Core

O grafo necessário pela projeção de memberships do CRM Core é preparado pela
migração `20260910_atendimento_crm_core_identity_materialization_v1`. Ela é
aditiva, não é aplicada automaticamente e não popula linhas de negócio.

O contrato executável está em
[`atendimento-crm-core-identity-materialization.json`](atendimento-crm-core-identity-materialization.json).
O comando de leitura é:

```text
node crm/api/scripts/preflight-atendimento-crm-core-identity-materialization.mjs --target staging|production
```

Ele aceita somente uma conexão de migrator dedicada por loopback TLS e retorna
metadados de esquema e de registry; não tem modo de aplicar, rollback, backfill
ou entrega.

## Política de identidade

- A identidade é ancorada em um UUID de cliente canônico que foi explicitamente
  reconciliado; o componente é sempre `attendance-client:<uuid>`.
- `client_name`, apelidos e qualquer aproximação textual não podem gerar UUID,
  criar link ou alterar uma associação existente.
- Uma presença em `crm_core_attendance_client_links` só entra na projeção quando o
  estado é `confirmed`, a evidência é um digest SHA-256 e a revisão de origem é
  positiva. O método precisa ser `operator_attested`,
  `stable_source_reference` ou `reviewed_reconciliation`.
- Links ambíguos, rejeitados ou não resolvidos são excluídos. Uma mudança de
  cliente canônico para um attendance já confirmado exige reconciliação revisada
  e não pode ser executada automaticamente. A revisão é monotônica; uma
  evidência diferente com a mesma revisão também exige revisão explícita.
- O grafo e o exporter permanecem limitados às quatro relações declaradas no
  catálogo. As relações novas usam exclusivamente o prefixo `crm_core_*` e não
  reutilizam as tabelas do reconciliador legado. Não há atributos de cliente no
  esquema novo nem cópia de payload para o CRM Core.
- A relação de membros tem uma chave estrangeira composta de
  `(identity_id, source_id)` para `(id, canonical_client_id)`. Assim, o banco
  rejeita um membro que associe uma identidade a outro cliente canônico, mesmo
  se ambos os UUIDs existirem isoladamente.
- A API opt-in `materializeAtendimentoCrmCoreIdentityLinks` não tem CLI, rota,
  scheduler nem leitura de ambiente. Ela exige `runId` UUID e links UUID
  explícitos, bloqueia o grafo, lê o estado persistido com `FOR UPDATE`, aplica
  a reconciliação monotônica e acrescenta somente um recibo opaco no ledger.
  Em staging/produção, ela exige o principal dedicado
  `crm_core_identity_materializer`; esta migração não cria o principal nem
  seus privilégios. Ela também recusa um schema retido cujo recibo da migration
  atual esteja ausente ou marcado como rollback.

## Admissão e rollback

A pré-verificação falha fechada se uma relação `crm_core_*` aparecer sem o
registro desta migração. Ela também confere as colunas UUID/texto e as duas
restrições de correspondência exigidas; portanto, um registro isolado não
valida por si só uma tabela antiga de formato incompatível. O estado da
migração ampla legada permanece somente como evidência de auditoria e não pode
dar acesso ao grafo isolado.

Como esta é uma correção do candidato `v1` ainda não aplicado, o preflight
também falha se encontrar seu recibo histórico sem as relações isoladas. Esse
caso exige uma migration aditiva nova; o executor não pode reutilizar o mesmo
ID para reparar um alvo já registrado.

A migration histórica `20260908_crm_core_projection_delta_v1` permanece
imutável e vinculada ao grafo legado; esta preparação não muda suas FKs nem
seu outbox. Antes de qualquer backfill de projeção a partir de `crm_core_*`, é
necessária uma migration delta-v2 aditiva, com nova custódia, prova de
compatibilidade e cutover explícito. Não há compatibilidade automática.

O rollback é apenas de registry: as tabelas e qualquer evidência futura são
mantidas. Aplicação real continua a exigir alvo, backup/checkpoint, executor
custodiado, teste em staging e o restante dos gates de backfill; este commit não
executa nenhuma dessas ações.
