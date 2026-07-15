# Atendimento: clone local seguro

O CRM local usa `skincos_crm_local` para leituras, métricas e simulações do módulo Atendimento. A origem real nunca é carregada automaticamente pelo serviço `crm.service`.

## Origem recuperada

O fluxo original foi recuperado do VHDX legado: Atendimento e Gerência eram lidos do Google Sheets por uma conta de serviço e importados no PostgreSQL local. A conta recuperada recebeu acesso `Leitor` às duas planilhas; ela não possui permissão para editar a origem.

O sincronizador baixa XLSX autenticados pela API do Google Drive usando exclusivamente os escopos `drive.readonly` e `spreadsheets.readonly`. Os snapshots privados em `/var/lib/skincos-runtime/crm/imports/` permanecem como contingência offline.

## Configuração privada no mini-PC

`/etc/skincos/atendimento-source.env` deve permanecer privado e apontar para a credencial recuperada:

```bash
ATENDIMENTO_SOURCE_MODE=google-sheets-live
ATENDIMENTO_GOOGLE_SA_FILE=/etc/skincos/atendimento-google-service-account.json
```

Não coloque a credencial em `crm-api.env`, `.dev.vars`, GitHub, Cloudflare, logs ou no repositório. `DATABASE_URL` em `crm-api.env` deve continuar apontando apenas para `skincos_crm_local`.

## Operação

```bash
npm run codex:crm:atendimento-mirror-status
npm run codex:crm:atendimento-mirror-sync -- --dry-run
npm run codex:crm:atendimento-mirror-sync -- --apply
```

`--apply` exige a confirmação `SINCRONIZAR`, salva um dump em `/var/lib/skincos-runtime/crm/backups/atendimento/`, conserva os dez últimos backups, reinicia o CRM API e roda o gate local. A atualização substitui simulações locais; use-a somente quando quiser renovar a base.

O reinício aguarda até 120 segundos pela porta `8099`, pois o serviço carrega os módulos do CRM a partir do release nativo antes de aceitar conexões. Se o health check não abrir nesse intervalo, a sincronização permanece aplicada e o comando falha explicitamente antes do gate.

## Garantias

- A origem Google é acessada com token OAuth de leitura e compartilhamento `Leitor`; o sincronizador não implementa chamadas de escrita.
- O destino precisa ser o banco local `skincos_crm_local`; destinos remotos e fontes vazias são recusados.
- Se a cópia falhar, a transação local é revertida e o clone anterior permanece disponível.
- `POST`, `PATCH` e `DELETE` do CRM local continuam funcionais apenas no clone local.
