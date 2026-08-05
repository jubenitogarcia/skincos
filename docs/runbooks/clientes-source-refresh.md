# Clientes: refresh seguro da fonte de Atendimento

O importador de Atendimento lê a planilha Google em modo somente leitura e
materializa as linhas idempotentes no schema `crm_atendimento`. Cada aplicação
concluída grava um checkpoint agregado em `crm_atendimento.import_batches`;
esse checkpoint é suficiente para a fila de qualidade reconhecer a fonte viva
mesmo quando o espelho local não existe.

## Runner

O entrypoint é `crm/api/scripts/refresh-atendimento-source.mjs` e aceita apenas
`--dry-run` ou `--apply`. O destino é obrigatório em
`CRM_CLIENTES_SOURCE_REFRESH_TARGET=staging|production`.

- `--dry-run` é a operação padrão: lê a fonte Google, valida o formato do
  banco-alvo e não abre nenhuma transação de escrita.
- `--apply` exige também
  `CRM_CLIENTES_SOURCE_REFRESH_APPLY_CONFIRMED=1`, a identidade correta do
  banco e o lock advisory `skincos:clientes:source-refresh`.
- A saída contém somente alvo, identidade agregada, contagens, abas, planilha e
  `importBatchId`; não inclui nomes, telefones, e-mails, payloads ou segredos.

O launcher nativo
`scripts/runtime/run-clientes-source-refresh-native.sh` carrega o ambiente
privado do alvo e o overlay de leitura Google separadamente. A variável
`DATABASE_URL` do alvo vence qualquer valor acidental no overlay da fonte. Em
`--apply`, um dump PostgreSQL privado é criado antes da importação em:

- produção: `/var/backups/skincos/clientes`;
- staging: `/var/backups/skincos/clientes/staging`.

O dump e seu SHA-256 ficam fora do repositório. A transação do importador é
atômica; em caso de falha, o checkpoint permanece para investigação e os dados
da importação são revertidos pelo banco.

## Operação controlada

Antes de qualquer escrita, execute o mesmo release em dry-run:

```bash
CRM_CLIENTES_SOURCE_REFRESH_TARGET=staging \
CRM_CLIENTES_SOURCE_REFRESH_ACTION=--dry-run \
scripts/runtime/run-clientes-source-refresh-native.sh
```

Depois de revisar apenas as contagens e a identidade do alvo, a aplicação
controlada usa:

```bash
CRM_CLIENTES_SOURCE_REFRESH_TARGET=staging \
CRM_CLIENTES_SOURCE_REFRESH_ACTION=--apply \
CRM_CLIENTES_SOURCE_REFRESH_APPLY_CONFIRMED=1 \
scripts/runtime/run-clientes-source-refresh-native.sh
```

O serviço e o timer em
`ops/runtime/units/crm-clientes-source-refresh.{service,timer}` são instalados
por `scripts/runtime/install-clientes-source-refresh-service.sh`. A unidade
fica em `--dry-run` e desabilitada por padrão; habilitar o timer não inicia
uma execução imediatamente. Para um ambiente de produção, o arquivo privado
`crm-clientes-source-refresh.env` deve declarar explicitamente o alvo, a ação e
a confirmação de escrita. Sem essa declaração o processo falha fechado.

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
