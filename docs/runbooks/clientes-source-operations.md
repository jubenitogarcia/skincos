# Operação contínua das fontes de Clientes

## Escopo e limites

O processo `crm/api/clientes-sources-worker.js` é independente do processo HTTP
(`crm/api/server.js`). Ele lê e, quando explicitamente autorizado, aplica apenas
fontes no espelho local ou no PostgreSQL de staging isolado. Não inicia Harmonia,
não envia mensagens, não abre fila comercial e não promove produção.

O unit systemd fica desabilitado e em `dry-run` por padrão. `/health`,
`/readiness` e `/sources` escutam somente em `127.0.0.1`/`::1` na porta 8103.

## Catálogo efetivo

| Fonte | Domínio | Cadência | Leitura/aplicação |
| --- | --- | ---: | --- |
| `atendimento.local_mirror` | atendimento | 30 min | PostgreSQL read-only, snapshot repeatable-read; backup e atualização do espelho local |
| `atendimento.google_sheet` | atendimento | 30 min | planilha canônica/tabs operacionais; upsert de registros e cache |
| `cadastro.gerencia_google_sheet` | cadastro | 30 min | roster, agenda, procedimentos, inventário e metas; upsert aditivo |
| `vendas.caixa_google_sheet` | vendas | 60 min | abas `BarraShoppingSul` e `Novo Hamburgo`; upsert por `(sheet, tab, row)` |
| `cadastro.app_registrations` | cadastro | 60 min | agregado materializado local, somente leitura |
| `leads.supplemental_google_sheet` | leads | 60 min | perfis normalizados; links de identidade não são confirmados automaticamente |
| `consent.harmonia_opt_outs` | consentimento | 5 min | agregado de opt-outs em `harmonia.contacts`, somente leitura |
| `blocks.commercial_permissions` | bloqueios | 5 min | agregado de bloqueios, somente leitura |
| `identity.global_graph` | identidade | 15 min | agregado do grafo global, somente leitura |

Cada execução grava watermark, fingerprint SHA-256, contagens, cobertura,
`snapshot_complete`, duração, erro allowlisted, status, retries e próximos
horários em `crm_atendimento.clientes_source_*`. Nenhuma métrica, log ou
artefato operacional contém nome, telefone, e-mail, linha bruta ou token.

## Segurança de snapshot e ausência

Uma fonte declarada como snapshot só pode aplicar quando o adaptador provar
`snapshotComplete=true` e registrar a cobertura esperada. Snapshot incompleto
vira `incomplete` e não aplica. Watermark anterior ao checkpoint vira `invalid`
e não altera o checkpoint novo. Locks PostgreSQL por fonte e idempotência por
`source_id + watermark + fingerprint` impedem concorrência e sobrescrita antiga.

Ausência em uma leitura nunca remove ou aposenta cliente, lead, venda,
permissão, opt-out ou identidade. As importações contínuas são aditivas; o
espelho local só é substituído pela rotina de espelho já existente, dentro de
uma transação, após prova repeatable-read completa e com backup restaurável.

## Freshness e findings

`healthy` é menor que 24h; de 24h a 48h abre finding preventivo `medium`; a
partir de 48h ou sem aplicação válida o finding é `high`. Uma observação stale
reabre automaticamente finding resolvido. O fechamento ocorre apenas quando a
observação atual está saudável. Eventos permanecem no ledger append-only de
qualidade.

## Ativação segura

1. Instale somente depois de validar a unidade, sem iniciar o processo:

   ```bash
   scripts/runtime/install-clientes-source-operations-service.sh
   ```

2. Aplique a migration aditiva no destino autorizado:

   ```bash
   CLIENTES_SOURCE_OPERATIONS_TARGET=local \
   DATABASE_URL='postgresql:///skincos_crm_local?host=/var/run/postgresql' \
   npm --prefix crm/api run migrate-clientes-source-operations -- --dry-run
   CLIENTES_SOURCE_OPERATIONS_TARGET=local \
   DATABASE_URL='postgresql:///skincos_crm_local?host=/var/run/postgresql' \
   npm --prefix crm/api run migrate-clientes-source-operations -- --apply
   ```

3. Execute o worker em `dry-run` e confirme readiness. Para `apply`, altere a
   configuração privada para `CRM_CLIENTES_SOURCE_OPS_MODE=apply` e forneça
   `CRM_CLIENTES_SOURCE_APPLY_CONFIRMED=1`. O launcher rejeita qualquer outro
   destino, host não-loopback, comando shell ou instalação de dependências.

4. Consulte a visão sem PII:

   ```bash
   curl -sS http://127.0.0.1:8103/health
   curl -sS http://127.0.0.1:8103/readiness
   curl -sS http://127.0.0.1:8103/sources
   npm --prefix crm/api run clientes-source-operations:status
   ```

## Falha, retry e rollback

Erros transitórios usam backoff exponencial limitado. Após três tentativas a
execução vira `dead` e entra em `clientes_source_dead_letters`; a evidência é
append-only. Reinício lê o checkpoint e retoma a fonte sem duplicar aplicação.
Antes de qualquer aplicação mutável é criado dump custom no diretório privado
`/var/backups/skincos/clientes/source-operations`. Para rollback, pare o
worker, use o `backup_ref` da execução e `pg_restore` através do adaptador;
depois reavalie findings e readiness. O rollback de migration é não destrutivo
e preserva ledger/evidência.

## Validação operacional

Os testes cobrem dry-run, apply, repetição idempotente, snapshot incompleto,
watermark antigo, lock concorrente, retry/dead-letter, retomada, rollback,
health com banco indisponível, readiness 503, SIGTERM liberando a porta,
separação do HTTP, unidade/launcher e ausência de PII. O smoke local não usa
credenciais Google nem dados comerciais; staging só é considerado validado
quando houver uma execução isolada observável no destino autorizado.

Não executar este runbook com `target=production`. A PR antiga #1160, que tentou
separar o processo em outra base, permanece apenas como referência histórica;
esta implementação foi reescrita sobre o `main` atual, em branch/PR isolada, e
não incorpora aquela branch defasada.
