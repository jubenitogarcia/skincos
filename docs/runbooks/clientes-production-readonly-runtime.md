# Clientes/Atendimento: runtime isolado somente leitura

## Estado verificável

Este runbook descreve o contrato versionado do runtime isolado. A presença dos
scripts **não** prova provisionamento, migração, instalação de unidade, DNS,
túnel, staging ou produção. Nesta tranche nenhum desses ambientes é alterado.
O ponto de partida seguro é `maintenance`, com todas as escritas comerciais
desligadas e sem canário.

| Limite | Contrato |
| --- | --- |
| Processo | `crm-atendimento-{staging,production}.service` executa somente `crm/api/server/atendimentoRuntime.js`; ele não importa `server.js` nem workers Harmonia. |
| Bind | Loopback apenas: staging `127.0.0.1:8111`, produção `127.0.0.1:8110`. |
| Liveness | `GET /health` e `GET /api/atendimento/health` respondem `200` sem consultar PostgreSQL e sem PII. |
| Readiness | `GET /internal/readiness` requer loopback e `x-atendimento-readiness-token`; responde `503` se controle, replay, banco, role, schema, fonte ou aprovação clínica falharem. |
| Dados | Produção usa `skincos_clientes_production`, `skincos_clientes_ro` (somente leitura) e `skincos_clientes_migrator_login` (migration separada). O app não recebe grant de contatos brutos Harmonia/Caixa. |
| Escritas | O gateway e o processo aceitam somente `GET`, `HEAD` e `OPTIONS`; qualquer outro método retorna `405 READ_ONLY_RUNTIME`. |
| Controle | O JSON local exige `readOnly:true`, `commercialContactWritesEnabled:false`, `syntheticOnly:true` e SHA exato antes de ficar `active` ou `canary`. |
| Ator | Atores usam HMAC v2 ligado a método, caminho, query, nonce e timestamp; nonce é persistido em ledger local com lock, expiração e replay fail-closed. |

As unidades removem `NODE_OPTIONS`, carregadores Node, `LD_PRELOAD` e outras
variáveis capazes de alterar a execução. Arquivos privados são lidos como pares
literais `CHAVE=valor` pelo Node, nunca com `source`, `eval` ou `bash -c`.

## Flags que devem permanecer falhas-fechadas

| Campo/flag | Valor inicial obrigatório |
| --- | --- |
| `ENABLE_ATENDIMENTO_DEPLOY` | `false` |
| `CRM_ATENDIMENTO_READ_ONLY` | `true` (fixado na unidade) |
| `CRM_ATENDIMENTO_CLIENTES_ONLY` | `true` (fixado na unidade) |
| `CRM_ATENDIMENTO_COMMERCIAL_WRITES_ENABLED` | `false` (fixado na unidade) |
| `HARMONIA_WORKER_ENABLED` | `false` (fixado na unidade) |
| `WA_BOOTSTRAP_SYNC_ENABLED` | `false` (fixado na unidade) |
| `commercialContactWritesEnabled` | `false` (arquivo de controle) |
| `syntheticOnly` | `true` (arquivo de controle) |
| estado inicial | `maintenance` |
| canário | vazio; nenhuma identidade real é incluída |

## Sequência autorizável (não executada por este runbook)

1. Verifique o artefato candidato em `main`, a linhagem predecessor e o
   estado `maintenance`. Use primeiro o modo seco:

   ```bash
   scripts/provision-atendimento-production-readonly.sh --dry-run
   scripts/runtime/prepare-atendimento-production-release.sh \
     --release-sha <sha-main> --predecessor-sha <sha-anterior>
   ```

2. Em staging isolado, primeiro provisione o contrato com o app read-only e o
   migrador separado. O provisionamento cria somente um controle `maintenance`
   em `/etc/skincos/atendimento-staging/module-control.json`, gera o token de
   readiness no env privado e concede ao app apenas `SELECT`/`USAGE`; ele não
   abre uma rota nem inicia uma unidade. Execute a migration apenas pelo
   invólucro fixo. Ele faz backup em
   `/var/backups/skincos/clientes/staging`, lê exclusivamente
   `/etc/skincos/crm-atendimento-staging-migrator.env` como texto literal e
   aceita uma só ação:

   ```bash
   scripts/run-atendimento-staging-migration.sh --dry-run
   ```

   Antes de qualquer `--apply`, prove as migrations aditivas de fontes e de
   aprovação clínica. Se elas ainda não existirem no staging, readiness deve
   continuar `503`; não contorne isso com grants, schema automático ou flag.

3. Antes de instalar a unidade isolada de staging, prepare a release imutável e
   grave explicitamente o SHA no controle ainda em `maintenance`. O instalador
   valida esse JSON pelo mesmo parser do runtime e se recusa a iniciar caso o
   SHA, `readOnly:true`, `commercialContactWritesEnabled:false` ou
   `syntheticOnly:true` não coincidam. Os comandos `--apply` são operações
   nativas que exigem o gate técnico correspondente; eles nunca reiniciam
   `crm.service`:

   ```bash
   scripts/runtime/prepare-atendimento-staging-release.sh \
     --release-sha <sha-main>
   scripts/set-atendimento-staging-control.sh \
     --state maintenance --release-sha <sha-main> \
     --reason release-preflight --apply
   scripts/runtime/install-atendimento-staging-service.sh \
     --source-root /opt/skincos/releases/<sha-main>/source
   ```

4. Após evidência de staging, registre a release imutável e instale somente a
   unidade dedicada de produção. Os comandos `--apply` são operações nativas de
   produção e exigem o gate técnico correspondente; eles nunca reiniciam
   `crm.service`.

   ```bash
   scripts/runtime/prepare-atendimento-production-release.sh \
     --release-sha <sha-main> --predecessor-sha <sha-anterior> --apply
   scripts/runtime/install-atendimento-production-service.sh \
     --source-root /opt/skincos/releases/<sha-main>/source --apply
   ```

5. Mantenha o controle em `maintenance` até o smoke assinado do mesmo SHA,
   backup, readiness e prova de que serviços protegidos não mudaram. Só então,
   em uma promoção explicitamente aprovada, grave `active` ainda com escrita
   desativada:

   ```bash
   scripts/set-atendimento-production-readonly-control.sh \
     --state active --release-sha <sha-main> --reason read-only-validated --apply
   scripts/validate-atendimento-production-readonly.sh \
     --expected-release-sha <sha-main>
   ```

6. O túnel e o DNS de produção são etapas separadas. O instalador aceita somente um UUID
   de túnel e calcula o caminho fixo das credenciais; o roteamento DNS só ocorre
   com `--apply`. Nenhum deles reutiliza `cloudflare-runtime.service`.

   ```bash
   scripts/runtime/install-atendimento-production-tunnel.sh \
     --source-root /opt/skincos/releases/<sha-main>/source \
     --tunnel-id <uuid-minusculo>
   scripts/runtime/route-atendimento-production-dns.sh \
     --tunnel-id <uuid-minusculo>
   ```

O Pages proxy exige `ATENDIMENTO_API_TARGET` e
`ATENDIMENTO_ACTOR_HMAC_KEY` dedicados, assina HMAC v2 e não tem fallback para
`CRM_API_TARGET`, `ESCALA_ACTOR_HMAC_KEY` ou CRM compartilhado. Somente o
health PII-free pode ser público; `/internal/*` nunca é encaminhado pelo proxy.

O helper legado de rota de staging foi aposentado e recusa `--apply`: ele não
deve alterar o `cloudflare-runtime.service` compartilhado. Até um túnel de
staging dedicado ser aprovado, o runtime isolado de staging é validado apenas
por loopback.

## Evidência mínima por etapa

- `GET /health` = `200` quando banco está indisponível;
- readiness interno = `200` só com banco, schema, fontes, aprovação clínica,
  role esperado e transação read-only válidos;
- readiness interno = `503` durante indisponibilidade controlada do banco;
- smoke assinado do SHA promovido prova `GET`, replay rejeitado e `POST` =
  `405`, sem mensagem, consentimento, contato, campanha ou decisão de
  identidade;
- `SIGTERM` libera a porta do processo dedicado;
- snapshot de PID/timestamp prova que `crm.service`, jobs, Orb e túnel
  compartilhado não foram reiniciados;
- logs, métricas e artefatos contêm apenas status/contagens/códigos, nunca
  telefone, e-mail, payload, URL com senha ou segredo.

## Métricas e observabilidade

`GET /internal/metrics` usa o mesmo limite loopback+token da readiness e expõe
somente `startedAt`, `requests`, `responses5xx`, `actorRejects`,
`replayRejects`, `readinessChecks` e `readinessFailures`. Ele não inclui caminho
da requisição, ator, unidade, identidade ou qualquer PII. Lag, última execução,
duração, erro e retry dos jobs contínuos pertencem exclusivamente a
`crm-jobs.service`; o runtime HTTP isolado não executa fila nem tenta mascarar
um worker ausente como saudável.

## Rollback

O desligamento imediato é trocar o controle para `maintenance` ou `disabled`.
Para um rollback de release, use somente um SHA previamente registrado e
imutável:

```bash
scripts/runtime/rollback-atendimento-production.sh --to-sha <sha-anterior>
```

O script valida o manifest, instala apenas
`crm-atendimento-production.service` do SHA de retorno, executa o smoke fixo e
compara PIDs/timestamps dos serviços protegidos. Migrations e dados permanecem
aditivos; se uma dependência não puder ser desfeita, mantenha o módulo em
`maintenance` e recupere apenas do backup/checkpoint aprovado.
