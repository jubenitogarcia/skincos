# Atendimento: clone local seguro

O CRM local usa `skincos_crm_local` para leituras, métricas e simulações do módulo Atendimento. A origem real nunca é carregada automaticamente pelo serviço `crm.service`.

## Origem recuperada

O fluxo original foi recuperado do VHDX legado: Atendimento e Gerência eram lidos do Google Sheets por uma conta de serviço e importados no PostgreSQL local. A conta recuperada recebeu acesso `Leitor` às duas planilhas; ela não possui permissão para editar a origem.

O sincronizador baixa XLSX autenticados pela API do Google Drive usando exclusivamente os escopos `drive.readonly` e `spreadsheets.readonly`. Os snapshots privados em `/var/lib/skincos-runtime/crm/imports/` permanecem como contingência offline.

## Configuração privada no mini-PC

O launcher roda como o operador `admin`, nunca como a conta de serviço. Ele
prefere o overlay privado do operador em
`C:\CodexRuntime\operator\admin\skincos\private\atendimento-mirror.env`
(`/mnt/c/CodexRuntime/operator/admin/skincos/private/atendimento-mirror.env`
no WSL). Se necessário, o caminho pode ser substituído por
`SKINCOS_ATENDIMENTO_OPERATOR_ENV_FILE`.

O overlay contém somente variáveis, nunca é versionado e deve ser legível
apenas pelo operador. O launcher lê os arquivos compatíveis de serviço primeiro
e carrega o overlay por último: ele vence qualquer valor legado e uma variável
`DATABASE_URL` acidental em uma configuração de origem não pode redirecionar o
destino. Os arquivos em `/etc/skincos` não devem ter sua permissão ampliada para
viabilizar a sincronização:

```bash
DATABASE_URL=postgresql:///skincos_crm_local?host=/var/run/postgresql
ATENDIMENTO_SOURCE_MODE=google-sheets-live
ATENDIMENTO_GOOGLE_SA_FILE=/caminho/privado/legivel-pelo-admin/service-account.json
```

`/etc/skincos/atendimento-source.env` continua sendo uma fonte compatível
quando já estiver legível para o operador; não copie nem exponha seu conteúdo.
Não coloque a credencial em `crm-api.env`, `.dev.vars`, GitHub, Cloudflare,
logs ou no repositório. `DATABASE_URL` deve continuar apontando apenas para
`skincos_crm_local` pelo socket Unix local.

## Operação

```bash
npm run codex:crm:atendimento-mirror-status
npm run codex:crm:atendimento-mirror-preflight
npm run codex:crm:atendimento-mirror-sync -- --dry-run
npm run codex:crm:atendimento-mirror-sync -- --apply
```

`--preflight` é obrigatório antes de um refresh. Ele abre apenas transações
`READ ONLY`, confirma que origem e destino não são o mesmo banco e retorna
somente contagens, faixa de atendimentos, frescor e um fingerprint sem
credenciais ou linhas de cliente. Ele não executa DDL, migrations ou qualquer
escrita no clone. `--status` também é estritamente de leitura e não inicializa
o schema. `--dry-run` aplica a mesma regra: lê a origem e verifica o destino
em transação somente leitura, sem abrir o bootstrap do store, DDL, migration
ou escrita.

`--apply` exige a confirmação `SINCRONIZAR`, aceita apenas o socket Unix local
do banco `skincos_crm_local`, salva um dump em
`/var/lib/skincos-runtime/crm/backups/atendimento/`, conserva os dez últimos
backups, reinicia o CRM API e roda o gate local. Uma trava de sessão impede duas
sincronizações concorrentes desde o checkpoint até a restauração. A atualização
substitui simulações locais; use-a somente quando quiser renovar a base.

O reinício aguarda até 120 segundos pela porta `8099`, pois o serviço carrega os módulos do CRM a partir do release nativo antes de aceitar conexões. Se o health check não abrir nesse intervalo, a sincronização permanece aplicada e o comando falha explicitamente antes do gate.

## Garantias

- A origem Google é acessada com token OAuth de leitura e compartilhamento `Leitor`; o sincronizador não implementa chamadas de escrita.
- O destino precisa ser o banco local `skincos_crm_local`; destinos remotos e fontes vazias são recusados.
- Se a cópia falhar, a transação local é revertida e o clone anterior permanece disponível.
- `POST`, `PATCH` e `DELETE` do CRM local continuam funcionais apenas no clone local.
