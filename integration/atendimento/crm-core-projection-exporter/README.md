# Exportador de projeções opacas de Atendimento para CRM Core

Este adaptador prepara lotes de backfill v2 para o CRM independente, em uma
transação PostgreSQL `REPEATABLE READ ONLY`. A tabela de identidades globais não
possui `unit_slug` por si só; a fonte padrão para dados reais é a associação
confirmada de Atendimento em
`src/atendimentoConfirmedUnitScopedProjectionSource.mjs`, que resolve o slug
somente pelas evidências e unidades canônicas do owner.

Toda execução exige uma fonte injetada e atestada pelo owner de Atendimento,
com uma linha estrita por vínculo identidade/unidade:

```text
{ id, updated_at, unit_slug }
```

`unit_slug` deve ser o slug canônico, minúsculo, sem curingas (`all`) ou
sentinelas (`unknown`). A mesma identidade pode aparecer em mais de uma
unidade, uma vez por unidade; ela vira eventos opacos distintos.

Antes de o lote sair do adaptador, cada UUID vira uma referência HMAC opaca:

- `source:` identifica a origem sem expor o UUID;
- `projection:` identifica a projeção CRM sem copiar o registro do cliente;
- `event:` torna o replay idempotente e inclui o `unit_slug`, evitando colisão
  de uma identidade legítima multiunidade.

O lote não contém nomes, e-mails, telefones, contato, sessões, cookies,
credenciais, dados de venda ou qualquer outra coluna da origem. A chave HMAC
fica somente na custódia operacional privada; ela nunca é escrita neste
repositório, em logs ou em recibos Git.

## Entrega paginada para o Worker isolado

`createPaginatedAtendimentoProjectionBackfillRunner(...)` é o runner de
staging explícito. Ele só aceita o intent
`ATENDIMENTO_CRM_PROJECTION_BACKFILL_RUN_INTENT`, rejeita alvo `production` e
exige capacidades já construídas pelo operador:

- pool PostgreSQL autenticado como `crm_core_projection_exporter`, com acesso
  somente leitura à fonte explicitamente aprovada pelo owner;
- descritor de fonte `atendimento/crm-core/unit-scoped-projection-source/v1`,
  com `countSql`, `rowsSql`, `firstPageSql` e `nextPageSql`; as páginas devem
  expor somente `id`, `updated_at` e `unit_slug` com aliases explícitos;
- chave HMAC sob custódia externa para transformar UUIDs em referências opacas;
- signer Ed25519 injetado, com key ID iniciado por
  `crm-staging-atendimento-backfill-`;
- transporte HTTPS injetado para a rota exata
  `/crm/_internal/backfill/atendimento`;
- recibo HTTP estrito `crm-core/projection-backfill-receipt/v2`, vinculado ao
  lote, request ID e artefato alvo; o envelope assinado de entrega continua em
  `skincos-crm/projection-backfill-delivery/v1`;
- checkpoint privado com operações `read`, `write` e `complete`.

O runner abre uma única transação `REPEATABLE READ READ ONLY`, atesta a fonte e
usa paginação por chave `(updated_at, id, unit_slug)`, nunca `OFFSET`. Cada lote contém no
máximo 20 eventos. A consulta converte `updated_at` para UTC com seis dígitos
de microssegundo, e o cursor privado preserva essa precisão; a data pública do
evento continua no formato do contrato CRM. O transporte limita o corpo a 64
KiB, tem deadline padrão de 15 segundos (máximo configurável de 60 segundos),
envia apenas `content-type` e `x-request-id`, omite credenciais e rejeita
redirects, cookies, `Origin` e `Authorization`. A resposta precisa vincular
exatamente o lote, o request ID e o release/digest do artefato CRM Core esperado.

Antes de qualquer entrega, o checkpoint privado recebe o pacote opaco completo
e a prova detached Ed25519. Se a entrega falhar sem recibo, a próxima execução
repete esse mesmo pacote antes de abrir uma nova transação. Ela só pode
continuar a paginação se o novo preflight confirmar a mesma contagem e o mesmo
HMAC do conjunto ordenado de triplas `(updated_at, id, unit_slug)`. O HMAC não contém a
origem em claro e torna a retomada independente do novo `transaction_timestamp`;
caso a entrada do backfill tenha mudado, o runner falha fechado depois do replay,
sem substituir o checkpoint. Antes até do replay, ele compara o alvo gravado ao
alvo configurado e recusa um artefato CRM diferente. O cursor UUID e o pacote
pendente nunca aparecem na resposta do runner, em logs ou no Git.

O exportador falha fechado quando o principal, banco, transação somente-leitura,
contagem, formato de linha, lote, prova, endpoint, resposta ou limite não
correspondem ao contrato. O teto da fonte continua sendo 10.000 linhas; se a
carga exceder isso, ele não cria um backfill parcial.

## Fonte canônica confirmada pelo owner de Atendimento

`src/atendimentoConfirmedUnitScopedProjectionSource.mjs` fornece o descritor
canônico `ATENDIMENTO_CONFIRMED_UNIT_SCOPED_PROJECTION_SOURCE`. Ele reproduz a
mesma regra já usada pelo runtime comercial de Atendimento: uma identidade tem
escopo em cada unidade comprovada pelos canais com ciclo de vida verificável
abaixo, e o slug só
é aceito após resolver contra `crm_atendimento.units`.

- atendimento ativo: `global_client_identity_members` →
  `attendance_client_links` → `attendances` não deletado;
- venda Caixa: `global_client_identity_members` → `crm_caixa.sales`.

`app_client_registrations` e `supplemental_lead_profiles` ficam explicitamente
fora desta fonte. Os importadores atuais retêm linhas de snapshots antigos e o
contrato de cobertura declara `snapshotComplete: false` e
`absenceIsRetirementEvidence: false`; incluí-los poderia manter uma associação
que a origem já revogou. Eles só entram depois que o owner disponibilizar um
snapshot completo com prova de aposentadoria ou tombstones explícitos.

Evidências repetidas para a mesma identidade/unidade são reduzidas a uma única
linha; evidências em unidades diferentes constituem uma associação multiunidade
válida, sem uma regra arbitrária de precedência. Uma identidade sem evidência
canônica não gera linha alguma: não há fallback global, `all` ou `unknown`.

As consultas continuam somente leitura, sem `OFFSET` ou DDL/DML, e usam a chave
`(updated_at, id, unit_slug)`. `updated_at` é o carimbo observável usado pelo
snapshot/cursor; não é uma revisão monotônica do CRM Core. O evento emitido tem
`revision: 1`, portanto este caminho é exclusivamente para o backfill inicial e
o replay exato do mesmo pacote. Remoções de vínculo ou sincronização incremental
exigem um contrato posterior com tombstone e revisão monotônica; não devem ser
simuladas reenviando esta fonte com revisão 1.

Esse carimbo vem de campos imutáveis de criação da evidência, não de
`updated_at` de importadores ou materializadores. Uma troca real de identidade
ou unidade altera o conjunto de memberships e gera o `revoke`/`upsert` próprio
do reconciliador; um refresh idempotente não deve aumentar revisões do outbox.

Ainda é necessário que o operador provisione externamente o principal
`crm_core_projection_exporter` com `SELECT` somente nas relações e colunas que
essa consulta usa. Este repositório não cria usuário, senha, grant, conexão ou
qualquer acesso ao banco de produção.

## Delta incremental e tombstones

O caminho de backfill acima é somente o snapshot inicial. Para alterações
posteriores, o owner Atendimento mantém uma tabela de estado
`crm_atendimento.crm_core_projection_memberships` e o outbox append-only
`crm_atendimento.crm_core_projection_outbox`, criados pela migration
`20260908_crm_core_projection_delta_v1`. A reconciliação ocorre em uma
transação `REPEATABLE READ` protegida por `pg_advisory_xact_lock`: novos ou
alterados vínculos geram `upsert`, e vínculos ausentes geram uma única revisão
`revoke` retida como tombstone. Uma execução repetida sem mudança não cria
eventos.

`atendimentoProjectionDeltaExporter.mjs` expõe o contrato versionado
`atendimento/crm-core/projection-delta-source/v1` e monta lotes
`skincos-crm/projection-delta-batch/v1`. O outbox é consultado somente por
`event_order`, sem `OFFSET`, com limite de 20 eventos e high-watermark fixo. A
ordenação precisa ser estritamente crescente dentro de cada página; intervalos
vazios são aceitos porque o PostgreSQL pode consumir um valor de identidade em
uma transação que depois sofreu rollback. O outbox é append-only e não permite
deleções, então um intervalo vazio não representa um evento perdido. O runner
mantém a retomada pelo último `event_order` efetivamente lido e continua com a
mesma garantia de rejeição de regressão de revisão. Cada evento usa o
contrato CRM Core `crm-projection-event/v2`, com operação exclusivamente
`upsert` ou `revoke`; o UUID do outbox e o UUID da identidade só participam do
HMAC e nunca são serializados no lote.

`paginatedAtendimentoProjectionDeltaRunner.mjs` é um runner de staging
opt-in. Ele recebe pool, chave HMAC, signer, transporte e checkpoint privado
por injeção, repete exatamente um pacote pendente antes de abrir nova leitura,
vincula cada recibo ao artefato alvo e não possui defaults de URL, ambiente,
segredo, banco ou deploy. O transporte HTTPS separado usa a rota futura
`/crm/_internal/delta/atendimento`; a rota e a aplicação do Core continuam
desativadas até que o owner do CRM Core publique o consumidor correspondente e
prove o mesmo ciclo de artefato, smoke e rollback em staging.

O checkpoint delta v4 também armazena somente o fingerprint SHA-256 não secreto
da chave HMAC efetivamente usada. Uma retomada com outro material de chave,
mesmo que alguém reutilize o mesmo `keyId`, falha antes de replay ou leitura de
fonte; a chave em si não é serializada, registrada ou devolvida.

O runner só aceita um handoff
`atendimento/crm-core/projection-delta-baseline/v3` em estado `delta-ready`.
Esse handoff é uma máquina de estados explícita, persistida pelo owner da
fonte: `baseline-prepared` é capturado e semeado em uma única transação
`REPEATABLE READ`, com revisão 1 e watermark inicial; `baseline-accepted`
acrescenta um recibo Core v2 para cada lote; e `delta-ready` exige um readback
verificado que vincule o manifesto, a seed, as contagens e o watermark.
Além dos `keyId`, o documento fixa o fingerprint não secreto da chave de
identidade e uma allowlist explícita de unidades. O primeiro delta e todo
checkpoint restaurado são recusados antes de assinatura ou entrega quando a
chave ou o escopo não coincidem.

Na preparação transacional do owner, `prepareAtendimentoProjectionDeltaBaseline`
recebe apenas a chave HMAC de backfill por injeção. Depois da consulta canônica,
ainda dentro da mesma transação `REPEATABLE READ`, o próprio preparador deriva
os lotes v2 e o manifesto sanitizado das linhas opacas lidas, do snapshot e da
chave. Não há factory nem manifesto pré-calculado que possa trocar referências
opacas por linhas de outro snapshot. O preparador confere cada página e rejeita
duplicação global de `event.id` ou do par `(unitSlug, projection.reference)`
antes de semear ou confirmar a transação. Os pacotes opacos exatos também são
gravados junto ao handoff e podem ser recuperados somente pela leitura de
custódia do owner; essa leitura os verifica contra o manifesto persistido e não
os deriva novamente.

`target` nessa operação identifica o banco de origem que contém as linhas
canônicas e pode ser `production`; o `targetDescriptor` identifica o artefato
CRM Core receptor e continua obrigatoriamente em `staging`. Assim, o backfill
de origem real pode ser preparado para staging sem transformar esse caminho em
autorização de produção.

O backfill é um manifesto de 1 a 500 lotes, cada um com no máximo 20 eventos.
Os intervalos `fromOrdinal`/`toOrdinal` precisam cobrir exatamente a sequência
1..`rowCount`, sem lacunas, sobreposição ou omissão; a soma de eventos e a
união de `unitSlugs` precisam coincidir com o snapshot. O recibo HTTP real do
Core é exatamente `crm-core/projection-backfill-receipt/v2` com
`contractVersion`, `status`, `batchId`, `eventCount` e `target`; o `batchDigest`
fica no lote assinado e no manifesto, não é inventado no recibo. O readback v3
repete `manifestDigest`, `membershipDigest`, `watermark`,
`verifiedBatchCount`, `verifiedEventCount` e `target`, e só então o reconciliador
é liberado. Assim, o cursor inicial não é inferido de `0` e a primeira revisão
de uma projeção já presente no backfill pode ser `2`, enquanto uma identidade
nova continua podendo começar em `1`.

Um baseline inicial vazio é permitido somente quando o owner fornece uma
allowlist não vazia de unidades futuras. Assim, a fonte vazia não cria uma
exceção implícita: o primeiro evento continua sujeito à mesma allowlist antes
de checkpoint, assinatura ou entrega. A lista é persistida no baseline e no
checkpoint; ela nunca é inferida de uma fonte vazia.

O comando `prepare-atendimento-crm-core-projection-delta-baseline.mjs` apenas
transforma envelopes JSON fornecidos pelo operador (`--prepare`, `--accept` ou
`--ready`); ele não abre conexão, lê ambiente, acessa rede ou manipula segredo.
`--accept` recebe `{ baseline, receipt: [...] }`, com todos os recibos dos
lotes, e `--ready` recebe `{ baseline, readback }`. A seed deve ser calculada
no mesmo snapshot `REPEATABLE READ` usado para montar o manifesto; se o
digest/cursor/escopo, a cobertura ordinal, qualquer recibo ou o readback
divergir, o handoff é rejeitado antes de qualquer delta.

Nenhuma migration, reconciliação, drenagem de outbox ou cópia de dados reais é
executada por estes módulos automaticamente. O grant do principal
`crm_core_projection_exporter` deve ser concedido pelo operador de banco com
menor privilégio e registrado no recibo operacional antes de qualquer ativação.

## Preflight reutilizável e preparação sintética

`preflightAtendimentoProjectionSource(client, { maxRows, source })` é a parte
reutilizável da leitura: dentro de uma transação já aberta como `REPEATABLE
READ ONLY`, ela atesta o principal, captura o instante do snapshot e confirma
a contagem antes de qualquer seleção de identidade. O teto da fonte é sempre
10.000; o runner paginado mantém esse teto e não oferece forma de ampliá-lo.

`prepareSyntheticAtendimentoProjectionStaging(...)` é apenas um ensaio local
desabilitado por padrão. Ele só continua quando recebe a constante de intenção
explícita `ATENDIMENTO_SYNTHETIC_STAGING_PREPARATION_INTENT`, um alvo `staging`,
um pool criado por `createSyntheticAtendimentoProjectionFixturePool(...)` com
linhas sintéticas `{ id, updated_at, unit_slug }` e um
receptor criado por `createSyntheticAtendimentoProjectionReceiptReceiver()`.
As duas factories registram exclusivamente estado em memória; um cliente
PostgreSQL, pool, array, proxy ou receptor arbitrário é recusado antes de
`connect()` ou da entrega do recibo. Um alvo de produção é recusado antes de
ler o pool, a chave HMAC ou o receptor injetados.

O ensaio sintético anterior continua isolado: ele não compartilha cliente,
transporte, checkpoint ou configuração com o runner paginado. O novo runner
também não tem CLI, leitura de ambiente, arquivo de saída, banco, URL ou chave
embutidos. Uma entrega real de staging requer que o operador injete essas
capacidades e que o Worker CRM Core tenha o opt-in e a allowlist de digests
aprovados. Nada neste diretório autoriza produção.

## Ensaio remoto sintético fechado

`createSyntheticAtendimentoProjectionRemoteRehearsal({ target, endpoint })`
prepara, mas não ativa, um único ensaio remoto de `staging`. A factory gera em
memória uma chave HMAC de origem e uma chave Ed25519 efêmera, monta um lote
determinístico de um evento sintético e devolve somente o material público que
o operador externo precisa revisar:

- um `keyId` iniciado por `crm-staging-atendimento-backfill-` e sua JWK pública;
- uma allowlist com exatamente um `batchDigest`;
- identidade do alvo, `batchId`, contagem e `configurationDigest`.

Ela nunca devolve a chave privada, a chave HMAC, o UUID sintético ou os eventos.
O `batchId` é diferente de `backfill:atendimento:fixture-batch-0001`; portanto
o ensaio não reaproveita a allowlist de outro exercício. Preparar esse objeto
não abre conexão nem faz requisição HTTP.

Depois que um operador configurar externamente o opt-in de staging, a chave
pública e essa allowlist finita, `rehearse(...)` exige a intenção explícita
`ATENDIMENTO_SYNTHETIC_REMOTE_REHEARSAL_INTENT`, um `fetch` injetado e uma
função de reconciliação D1. Ele passa pela mesma fonte paginada, assinatura e
transporte HTTPS do produtor real, exige a primeira resposta `accepted`, repete
o pacote exato e exige `idempotent`, e só emite o recibo sanitizado após a
reconciliação confirmar o digest, alvo, cursor, unidades e evento persistidos. O adaptador
não lê ambiente, não possui URL de Worker embutida, não faz deploy e não é um
mecanismo de ativação de produção.

## Validação local

No ambiente Linux do projeto:

```text
node --test integration/atendimento/crm-core-projection-exporter/test/*.test.mjs
```

Essa validação usa apenas uma fonte sintética em memória. Ela não acessa banco,
Cloudflare, dados de clientes ou segredos.
