# Clientes: runtime de produção somente leitura

O runtime isolado de Clientes roda em `crm-atendimento-production.service`,
somente em `127.0.0.1:8110`. Ele usa uma release imutável, o banco local de
produção e o papel PostgreSQL `skincos_clientes_ro`, que possui apenas `SELECT`.
O processo também é limitado à superfície `/api/atendimento/commercial/*` e a
API recusa todo método diferente de `GET`, `HEAD` e `OPTIONS`.

Não existe rota pública neste tranche. A publicação de um alias, túnel ou
proxy exige uma revisão independente de autenticação, escopo de unidades,
PII, logs e rollback. O runtime compartilhado `crm.service` não é reiniciado
por nenhum dos scripts abaixo.

## Contrato e instalação

1. Provisione o contrato sem escrever:

   ```bash
   scripts/provision-atendimento-production-readonly.sh --dry-run
   ```

2. Depois de revisar o alvo e ter o backup/rollback operacional, aplique o
   contrato. O script cria uma senha aleatória somente no arquivo privado e
   inicia em `maintenance`:

   ```bash
   scripts/provision-atendimento-production-readonly.sh --apply
   ```

3. Prepare uma release nativa aprovada com
   `scripts/runtime/prepare-native-source-release.sh --stage-only`. O destino
   deve ser exatamente `/opt/skincos/releases/<sha>/source`; nenhum serviço
   pode executar um checkout ou worktree.

4. Instale somente o serviço isolado:

   ```bash
   scripts/runtime/install-atendimento-production-service.sh \
     --source-root /opt/skincos/releases/<sha>/source --apply
   ```

5. Após confirmar a linhagem da release, abra o controle local:

   ```bash
   scripts/set-atendimento-production-readonly-control.sh \
     --state active --release-sha <sha> --apply
   ```

O `--state maintenance` ou `--state disabled` é o rollback imediato e não
altera banco ou o CRM compartilhado. Cada alteração de unidade, configuração e
controle cria cópia privada em
`/var/backups/skincos/clientes/production-readonly`.

## Validação

Execute no host nativo, nunca no checkout Windows:

```bash
EXPECTED_STATE=active scripts/validate-atendimento-production-readonly.sh
```

A validação atesta serviço ativo, bind loopback, health do módulo, papel
PostgreSQL somente leitura, `SELECT` nas duas fontes necessárias e uma tentativa
assinada de `POST` que retorna `405 READ_ONLY_RUNTIME` antes de qualquer store
mutation. Não imprime nomes, telefones, e-mails, URLs com senha ou payloads.

## Próximo gate

Este runtime fecha o isolamento técnico, mas não autoriza publicá-lo. O próximo
incremento deve adicionar proxy/rota somente depois de uma prova autenticada,
escopo de unidade, redaction de PII e observabilidade; consentimento, campanha,
mensagem WhatsApp, revisão clínica e qualquer escrita permanecem bloqueados.
