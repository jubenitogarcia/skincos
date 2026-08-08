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
   abre uma rota nem inicia uma unidade. O invólucro da migration só executa
   a cópia imutável já preparada: isso garante o mesmo conjunto de dependências
   e a linhagem que a futura unidade consumirá. Em todo `--apply` ou
   `--rollback` de migration, depois dos gates e imediatamente antes do runner,
   ele cria e verifica exatamente um dump privado e único em
   `/var/backups/skincos/clientes/staging`; a evidência contém somente SHA-256,
   `private=true` e `unique=true`, nunca o caminho ou conteúdo do dump. Não
   chame o helper de backup separadamente nesse fluxo. O runner lê exclusivamente
   `/etc/skincos/crm-atendimento-staging-migrator.env` como texto literal e
   aceita uma só ação. A migração pode conceder temporariamente grants normais
   enquanto cria objetos; ao terminar (inclusive após rollback ou erro), o
   invólucro obrigatório `lockdown-atendimento-staging-runtime.sh` os revoga
   com o administrador local do PostgreSQL. A migration exige controle
   `maintenance` com o SHA esperado e a unidade isolada inativa, obtém lock
   advisory no banco e só então executa. O app fica sem DDL, DML, uso de
   sequences, `SET ROLE` para qualquer papel pai, atributos privilegiados,
   execução de funções `SECURITY DEFINER` em schemas de aplicação ou acesso a
   `harmonia.contacts`; a instalação e a validação recusam prosseguir se a
   prova efetiva de grants falhar.

3. Antes de instalar a unidade isolada de staging, prepare a release imutável e
   grave explicitamente o SHA no controle ainda em `maintenance`. O instalador
   valida esse JSON pelo mesmo parser do runtime e se recusa a iniciar caso o
   SHA, `readOnly:true`, `commercialContactWritesEnabled:false` ou
   `syntheticOnly:true` não coincidam. Os comandos `--apply` são operações
   nativas que exigem o gate técnico correspondente; eles nunca reiniciam
   `crm.service`:

   ```bash
   scripts/runtime/prepare-atendimento-staging-release.sh \
     --release-sha <sha-main> --predecessor-sha <sha-staging-anterior>
   scripts/set-atendimento-staging-control.sh \
     --state maintenance --release-sha <sha-main> \
     --reason release-preflight --apply
   scripts/run-atendimento-staging-migration.sh \
     --dry-run --release-sha <sha-main>
   scripts/run-atendimento-staging-migration.sh \
     --apply --release-sha <sha-main>
   scripts/runtime/install-atendimento-staging-service.sh \
     --source-root /opt/skincos/releases/<sha-main>/source
   ```

   Antes de qualquer `--apply` da migration, prove o plano de migrations
   aditivas de fontes, clusters, operações, analytics e aprovação clínica. Se
   elas ainda não existirem no staging, readiness deve continuar `503`; não
   contorne isso com grants, schema automático ou flag. O preparador recusa um
   SHA que não seja exatamente o `origin/main` buscado e grava a linhagem
   imutável com o predecessor confirmado. Não há túnel nem DNS de staging nesta tranche. A prova de liveness de
   staging é feita somente pelo validador nativo, no listener loopback fixo;
   ele compara a unidade instalada com o template renderizado da release,
   atesta o PID/cwd/linha de comando do processo e usa `curl --noproxy '*'`;
   portanto health de processo antigo, proxy ou binário no `PATH` não prova
   promoção. Actions hospedadas não devem chamar hostname público de staging:

   ```bash
   scripts/validate-atendimento-staging-readonly.sh \
     --expected-release-sha <sha-main>
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

### Rollback de staging, somente contenção

O rollback de staging não tem caminho para o CRM compartilhado. Ele só aceita
um par explícito de backups dos diretórios privados versionados: uma unidade
isolada e um controle `maintenance` do mesmo SHA. Os nomes são emitidos como
`unit_backup` pelo instalador e `control_backup` pelo escritor de controle;
registre ambos na evidência da promoção. Cada nome inclui um sufixo único
pré-criado pelo `mktemp`; nunca reutilize, renomeie ou substitua um backup.

```bash
scripts/runtime/rollback-atendimento-staging.sh \
  --to-sha <sha-staging-anterior> \
  --unit-backup <timestamp>-crm-atendimento-staging.<unico>.service \
  --control-backup <timestamp>-module-control.<unico>.json
```

O modo padrão verifica toda a cadeia sem alterar o host. Ele exige source
imutável, lineage e manifesto de Atendimento para staging, ownership/modo
privados, controle estrito em `maintenance` e uma unidade exatamente igual ao
template renderizado para o SHA. Com `--apply`, restaura exclusivamente esses
dois arquivos, executa `daemon-reload` e reinicia somente
`crm-atendimento-staging.service`; o controle continua em `maintenance`.
Qualquer falha mantém o módulo contido, sem chamar `crm.service`, jobs, Orb ou
túneis compartilhados.

O primeiro corte a partir de uma unidade legada `server.js` não possui par
compatível e é deliberadamente recusado: isso é contenção fail-closed, não um
rollback de release comprovado. Até existir um par isolado compatível, mantenha
staging em `maintenance` e use apenas o dump privado aprovado para recuperação
de dados; não restaure a unidade legada.

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
