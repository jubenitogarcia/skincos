# Atendimento — contrato de promoção independente

**Estado atual:** staging isolado operacional. O banco, o unit nativo, o arquivo
de controle, o túnel e a atestação pública são mantidos pelos scripts versionados
com backups privados. Os workflows continuam dispatch-only e apenas atestam o
SHA imutável e o health do runtime; nunca reiniciam `crm.service`.

## Fluxos canônicos

| Superfície | Workflow | Efeito atual |
| --- | --- | --- |
| Artefato/processo de Atendimento | `.github/workflows/deploy-atendimento.yml` | `workflow_dispatch` em `main` somente; valida o SHA com `promotion-gate.yml`, testa a API no preview e, em staging, atesta o health do runtime isolado após a transição nativa. |
| Disponibilidade do módulo | `.github/workflows/atendimento-availability.yml` | `workflow_dispatch` em `main` somente; mantém a mesma cadeia SHA/evidência e atesta o estado do arquivo de controle via health. |

O preview produz evidência somente depois da validação local do artefato. O
staging produz evidência adicional de health público, estado do módulo e banco
configurado, sem dados pessoais. Produção permanece separada e fail-closed até
existir um runtime isolado equivalente.

## Custódia e execução segura

Os dois workflows recusam qualquer ref que não seja `main`, replay de run e SHA
que não seja hexadecimal completo. `promotion-gate.yml` confirma que o SHA é
ancestral de `origin/main` e exige a evidência predecessor. O validador que lê
as variáveis do Environment é obtido de `github.workflow_sha`, não do checkout
do candidato.

`CRM_ATENDIMENTO_*_COMMAND` não aceita uma linha de shell. Cada valor deve ser
um identificador semântico resolvido por uma futura allowlist no executor nativo:

| Variável | Valor exigido |
| --- | --- |
| `CRM_ATENDIMENTO_DEPLOY_COMMAND` | `atendimento-release-deploy-v1` |
| `CRM_ATENDIMENTO_ROLLBACK_COMMAND` | `atendimento-release-rollback-v1` |
| `CRM_ATENDIMENTO_CONTROL_COMMAND` | `atendimento-module-control-v1` |

O único wrapper de Actions é
`.github/scripts/atendimento-deployment-contract.mjs`: ele compara esses
identificadores, grava evidência sem valores de variáveis e nunca chama `eval`,
`bash -c`, SSH, `systemctl` ou um comando vindo do Environment. Os scripts
nativos de preparação, controle, migration e instalação implementam essa
allowlist fora do checkout de runtime mutável; os valores nunca são
interpretados como comandos.

## Configuração externa que ainda falta

Nos Environments GitHub separados `staging` e `production`, configurar somente
os nomes abaixo com os valores específicos de cada ambiente:

| Variável | Contrato |
| --- | --- |
| `ENABLE_ATENDIMENTO_DEPLOY` | `false` por padrão; somente `true` permite a atestação do runtime nativo isolado. A transição efetiva continua sendo feita pelos scripts versionados, com backup e rollback. |
| `CRM_MODULE_CONTROL_FILE` | Exatamente `/etc/skincos/atendimento/module-control.json`. |
| `CRM_ATENDIMENTO_DEPLOY_COMMAND` | Identificador `atendimento-release-deploy-v1`. |
| `CRM_ATENDIMENTO_ROLLBACK_COMMAND` | Identificador `atendimento-release-rollback-v1`. |
| `CRM_ATENDIMENTO_CONTROL_COMMAND` | Identificador `atendimento-module-control-v1`. |
| `CRM_ATENDIMENTO_HEALTH_URL` | `https://crm-atendimento-staging.skincos.com.br/api/atendimento/health` em staging; `https://crm.skincos.com.br/api/atendimento/health` em produção. |

Pré-requisitos técnicos cobertos no staging:

1. o `crm-atendimento-staging.service` isolado, com porta, banco/role e health próprios;
2. suporte efetivo e testado de `CRM_DOMAIN=atendimento` e
   `CRM_MODULE_CONTROL_FILE` no processo — hoje o servidor CRM compartilhado não
   prova esse isolamento;
3. gateway/túnel com rota para o processo isolado em staging, sem redirecionar
   para `crm.service`;
4. scripts nativos confiáveis com allowlist dos três identificadores acima,
   autoria/auditoria por SHA e sem fallback de shell ou SSH do GitHub;
5. migration staging somente aditiva, banco alvo explicitamente identificado,
   checkpoint/backup e verificação de idempotência em staging;
6. registro do SHA candidato e do SHA de retorno, smoke autenticado do mesmo SHA
   e prova de rollback do processo isolado.

## Rollback e disponibilidade

O rollback futuro é sempre o SHA já promovido anterior: o executor deve manter
o arquivo de controle em `disabled` ou `maintenance`, repor apenas o processo
`crm-atendimento.service`, executar o health local/público e preservar dados,
ledgers e auditoria. Não deve reiniciar, parar ou reconfigurar `crm.service`,
Orb, Pages ou outros módulos. Migrations e registros comerciais permanecem
aditivos; se o dado não puder ser revertido com segurança, o rollback desliga a
escrita/controle e recupera somente de checkpoint aprovado em ambiente isolado.

O staging atende esses pré-requisitos e está apto a promoção sintética. A
produção permanece explicitamente desabilitada e sem rota de Atendimento
dedicada; nenhum workflow de produção é considerado executado enquanto esse
runtime equivalente não existir.
