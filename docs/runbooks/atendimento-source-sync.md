# Atendimento: sincronização privada da fonte

## Motivo

O runtime online de Atendimento é deliberadamente somente leitura e não
executa importadores. A API pode responder `200` com catálogo e espelho vazios
quando a fonte ainda não foi sincronizada; isso não é cache do navegador. O
antigo refresh genérico foi aposentado porque não tinha backup, checkpoint e
identidade de banco suficientemente restritos.

O caminho versionado é separado do HTTP:

| Componente | Contrato |
| --- | --- |
| `crm-atendimento-production.service` | somente leitura, app role `skincos_clientes_ro`, sem Google, sem DML |
| `crm-atendimento-source-sync.service` | `oneshot`, usuário `skincos`, somente fonte Google autenticada e banco migrador dedicado |
| `crm-atendimento-source-sync.timer` | desabilitado por padrão; quando habilitado, tenta a cada 30 minutos |
| lock | `skincos:atendimento:source-sync:v1` no PostgreSQL, além da idempotência por fingerprint |
| backup | dump custom privado antes de qualquer `apply`, em `/var/backups/skincos/clientes/production-source-sync` |

O sincronizador nunca reinicia `crm.service`, `crm-jobs.service`, Orb,
túnel ou Cloudflare. Ele também não ativa rotas comerciais, flags ou grants.

## Pré-requisitos privados

O operador nativo provisiona, fora do Git, o arquivo
`/etc/skincos/crm-atendimento-source-sync.env` com ownership `root:skincos`,
modo `0640`, e o JSON da conta de serviço Google com o mesmo limite de leitura.
O arquivo contém somente variáveis aprovadas pelo runner:

```text
DATABASE_URL=<URL do migrador dedicado, loopback, TLS, sem copiar a URL do app>
CRM_ATENDIMENTO_SOURCE_SYNC_TARGET=production
CRM_ATENDIMENTO_SOURCE_SYNC_ACTION=dry-run
CRM_ATENDIMENTO_SOURCE_SYNC_APPLY_CONFIRMED=0
ATENDIMENTO_GOOGLE_SHEET_ID=<planilha aprovada>
ATENDIMENTO_GOOGLE_SA_FILE=/etc/skincos/google-atendimento-source.json
```

Para aplicar, a custódia altera a ação para `apply` e a confirmação para `1`
somente depois do dry-run aprovado. A URL deve usar exatamente o login
`skincos_clientes_migrator_login` e o banco `skincos_clientes_production`;
o sincronizador rejeita app role, socket alternativo, host externo e query
string não permitida. Nenhum valor de senha deve aparecer em logs, PRs ou
evidência.

## Instalação e execução

A unidade deve ser instalada a partir do mesmo release imutável validado para
o runtime, nunca de um checkout mutável:

```bash
scripts/runtime/install-atendimento-source-sync-service.sh \
  --source-root /opt/skincos/releases/<sha-40>/source \
  --apply
```

O instalador exige a closure de coordenação de Atendimento, grava backup das
unidades anteriores, cria apenas os diretórios privados necessários e executa
`daemon-reload`. Ele não inicia a unidade. Para habilitar o timer, depois que
o arquivo privado existir e estiver validado:

```bash
scripts/runtime/install-atendimento-source-sync-service.sh \
  --source-root /opt/skincos/releases/<sha-40>/source \
  --apply --enable
```

Antes do primeiro `apply`, execute a operação de leitura com o mesmo release:

```bash
sudo -u skincos /usr/bin/node \
  /opt/skincos/releases/<sha-40>/source/crm/api/scripts/run-atendimento-source-sync.mjs \
  --dry-run
```

O dry-run confirma identidade, schema, acesso à planilha, formato, contagens,
abas e fingerprint, mas não cria backup nem linha de Atendimento. O `apply`
faz novamente a validação, adquire o lock, cria o dump privado e só então
grava unidades, referências, clientes, atendimentos e checkpoint agregado.
Uma fonte vazia é rejeitada. Um fingerprint já aplicado com atendimentos
existentes é reportado como `skipped` sem novo backup.

## Validação online

Após um apply bem-sucedido, valide o mesmo SHA e a jornada autenticada:

```text
GET /api/auth/me                         -> 200
GET /api/atendimento/health              -> 200
GET /api/atendimento/local-mirror/status -> 200, syncedAt preenchido
GET /api/atendimento/management/catalog  -> 200, unidades/referências não vazias
GET /api/atendimento/attendances         -> 200, total compatível com o relatório
```

No CRM online, recarregue `?module=atendimento`, confirme que a tabela deixou
de mostrar `Nenhum atendimento encontrado` e repita o botão de recarregar.
Registre somente contagens agregadas, fingerprint, import batch, SHA do
release, identidade do banco e estado do timer. Não registre nomes, contatos,
payloads, URL com senha ou dump.

## Falhas e rollback

Falha de Google, schema, identidade, lock ou backup interrompe o fluxo antes
da escrita. O runtime continua servindo o último espelho disponível; se não
houver espelho, a UI permanece vazia e deve mostrar o erro de fonte, não dados
sintéticos.

Para conter uma falha, desabilite o timer e mantenha o runtime em
`maintenance`/somente leitura. O rollback de código usa o SHA anterior
registrado e reinstala as duas unidades isoladas; não reinicia o CRM
compartilhado. O dump privado é o checkpoint de dados. Uma restauração só
deve ser feita pelo procedimento PostgreSQL aprovado, em banco dedicado e
com verificação posterior; não há reverse migration destrutiva nem exclusão
automática de linhas históricas.
