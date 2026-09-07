# Exportador de projeções opacas de Atendimento para CRM Core

Este adaptador prepara lotes de backfill para o CRM independente.
Ele lê exclusivamente `id` e `updated_at` de
`crm_atendimento.global_client_identities`, em uma transação PostgreSQL
`REPEATABLE READ READ ONLY`.

Antes de o lote sair do adaptador, cada UUID vira uma referência HMAC opaca:

- `source:` identifica a origem sem expor o UUID;
- `projection:` identifica a projeção CRM sem copiar o registro do cliente;
- `event:` torna o replay idempotente.

O lote não contém nomes, e-mails, telefones, contato, sessões, cookies,
credenciais, dados de venda ou qualquer outra coluna da origem. A chave HMAC
fica somente na custódia operacional privada; ela nunca é escrita neste
repositório, em logs ou em recibos Git.

## Entrega paginada para o Worker isolado

`createPaginatedAtendimentoProjectionBackfillRunner(...)` é o runner de
staging explícito. Ele só aceita o intent
`ATENDIMENTO_CRM_PROJECTION_BACKFILL_RUN_INTENT`, rejeita alvo `production` e
exige capacidades já construídas pelo operador:

- pool PostgreSQL autenticado como `crm_core_projection_exporter`, limitado a
  `CONNECT`, `USAGE` no schema `crm_atendimento` e `SELECT (id, updated_at)`;
- chave HMAC sob custódia externa para transformar UUIDs em referências opacas;
- signer Ed25519 injetado, com key ID iniciado por
  `crm-staging-atendimento-backfill-`;
- transporte HTTPS injetado para a rota exata
  `/_internal/crm/backfill/atendimento`;
- checkpoint privado com operações `read`, `write` e `complete`.

O runner abre uma única transação `REPEATABLE READ READ ONLY`, atesta a fonte e
usa paginação por chave `(updated_at, id)`, nunca `OFFSET`. Cada lote contém no
máximo 20 eventos. O transporte limita o corpo a 64 KiB, envia apenas
`content-type` e `x-request-id`, omite credenciais e rejeita redirects,
cookies, `Origin` e `Authorization`. A resposta precisa vincular exatamente o
lote, o request ID e o release/digest do artefato CRM Core esperado.

Antes de qualquer entrega, o checkpoint privado recebe o pacote opaco completo
e a prova detached Ed25519. Se a entrega falhar sem recibo, a próxima execução
repete esse mesmo pacote antes de abrir uma nova transação. Ela só pode
continuar a paginação se o novo preflight confirmar o mesmo `capturedAt` e a
mesma contagem de linhas; caso contrário, falha fechado depois do replay, sem
substituir o snapshot. O cursor UUID e o pacote pendente nunca aparecem na
resposta do runner, em logs ou no Git.

O exportador falha fechado quando o principal, banco, transação somente-leitura,
contagem, formato de linha, lote, prova, endpoint, resposta ou limite não
correspondem ao contrato. O teto da fonte continua sendo 10.000 linhas; se a
carga exceder isso, ele não cria um backfill parcial.

## Preflight reutilizável e preparação sintética

`preflightAtendimentoProjectionSource(client, { maxRows })` é a parte
reutilizável da leitura: dentro de uma transação já aberta como `REPEATABLE
READ READ ONLY`, ela atesta o principal, captura o instante do snapshot e
confirma a contagem antes de qualquer seleção de identidade. O teto é sempre
10.000; o runner paginado mantém esse teto e não oferece forma de ampliá-lo.

`prepareSyntheticAtendimentoProjectionStaging(...)` é apenas um ensaio local
desabilitado por padrão. Ele só continua quando recebe a constante de intenção
explícita `ATENDIMENTO_SYNTHETIC_STAGING_PREPARATION_INTENT`, um alvo `staging`,
um pool criado por `createSyntheticAtendimentoProjectionFixturePool(...)` e um
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

## Validação local

No ambiente Linux do projeto:

```text
node --test integration/atendimento/crm-core-projection-exporter/test/*.test.mjs
```

Essa validação usa apenas uma fonte sintética em memória. Ela não acessa banco,
Cloudflare, dados de clientes ou segredos.
