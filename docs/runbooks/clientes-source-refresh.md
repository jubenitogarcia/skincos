# Clientes: refresh seguro das fontes

> O entrypoint legado `crm/api/scripts/refresh-atendimento-source.mjs` e seu
> launcher nativo permanecem apenas como compatibilidade fail-closed e não
> devem ser reativados. Para sincronizar a fonte de Atendimento, use o
> [runbook dedicado](atendimento-source-sync.md), que executa em unidade
> isolada, com credencial Google privada, backup, lock e fingerprint.

O importador de Atendimento lê a planilha Google em modo somente leitura e
materializa as linhas idempotentes no schema `crm_atendimento`. Cada aplicação
concluída grava um checkpoint agregado em `crm_atendimento.import_batches`;
esse checkpoint é suficiente para a fila de qualidade reconhecer a fonte viva
mesmo quando o espelho local não existe.

## Runner legado (aposentado)

O entrypoint `crm/api/scripts/refresh-atendimento-source.mjs` recusa a execução
com `CLIENTES_SOURCE_LEGACY_REFRESH_DISABLED`. O destino histórico
`CRM_CLIENTES_SOURCE_REFRESH_TARGET=staging|production` não é uma autorização
para importar dados.

O serviço/timer histórico também não deve ser instalado. O caminho v2 de
Clientes continua reservado às operações explicitamente suportadas em
`crm-jobs.service`, com alvo e modo próprios; ele não é ponte para o banco
dedicado de Atendimento.

O launcher nativo
`scripts/runtime/run-clientes-source-refresh-native.sh` permanece como stub
fail-closed. Em particular, não deve ser usado para escrever no banco de
produção de Atendimento.

Não copie as variáveis ou o backup desse contrato para o sincronizador
dedicado. Os dois caminhos têm schemas, papéis e rollback diferentes.

## Qualidade e rollback

Após um apply, execute o refresh de qualidade comercial do mesmo alvo e
confirme que `source.local_mirror_stale` reconhece o novo checkpoint. O rollback
operacional é parar/desabilitar o timer, preservar o dump e restaurar o banco
com o procedimento PostgreSQL aprovado; não existe reverse migration destrutiva.

O refresh de qualidade é fail-closed para o papel de runtime: quando ele não
possui `SELECT` nas tabelas de governança de contato, não tenta ler linhas
protegidas, registra `commercial.contact_controls_unready` e mantém a fila
acionável. Não conceda acesso amplo apenas para obter a contagem agregada. No
alvo local de produção, o comando operacional deve usar o socket sem usuário
(`postgresql:///skincos_crm_local?host=/var/run/postgresql`) e executar como o
papel técnico autorizado; assim a verificação de destino permanece estrita.

## Projeção global após reconciliação legada

`reconcile-client-identities.mjs` mantém a camada histórica de clientes e
vínculos Atendimento↔Caixa. Para rematerializar o grafo global a partir das
fontes já persistidas, use
`reconcile-persisted-client-identities.mjs`. O runner reutiliza o mesmo builder
de componentes confirmados, lock do grafo, guard de histórico comercial e
ledger de materialização; não importa planilhas, não cria links novos e não
remove identidades históricas.

Faça primeiro o dry-run com um checkpoint privado:

```bash
DATABASE_URL='postgresql:///skincos_crm_local?host=/var/run/postgresql' \
CLIENT_IDENTITY_PROJECTION_CHECKPOINT_OUTPUT=/mnt/c/CodexRuntime/operator/admin/skincos/client-identity-projection-checkpoint.json \
node crm/api/scripts/reconcile-persisted-client-identities.mjs
```

O apply exige o checkpoint, `CLIENT_IDENTITY_PROJECTION_APPLY_CONFIRM=UNIFICAR`
e `CLIENT_IDENTITY_PROJECTION_APPLY_TARGET=skincos_crm_local`. A operação é
transacional e falha fechada se o fingerprint das fontes mudar ou se a
projeção tentar mover uma identidade com histórico comercial.

As migrations de Clientes também reconciliam os grants mínimos do runtime,
separados por responsabilidade:

- consentimento: `SELECT`/`INSERT`/`UPDATE` no estado atual e `SELECT`/`INSERT`
  no ledger imutável de eventos;
- ações: `SELECT`/`INSERT` no ledger imutável de eventos e acesso à sequência;
- qualidade: `SELECT`/`INSERT`/`UPDATE` apenas na fila agregada e
  `SELECT`/`INSERT` no ledger de eventos;
- identidade: `SELECT`/`INSERT` nos ledgers de revisão, membros, linhagem e
  links, `SELECT`/`INSERT`/`UPDATE` nas execuções de materialização e acesso às
  sequências de ordenação.

Nenhuma dessas migrations concede `DELETE` ou `TRUNCATE` nos ledgers, nem
acesso amplo a fontes protegidas. Reexecute o runner de migration com o mesmo
release quando o estado de grants estiver incompleto; a reconciliação é
idempotente e o relatório registra o papel técnico e cada grant aplicado.
