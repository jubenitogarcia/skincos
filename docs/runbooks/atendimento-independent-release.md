# Atendimento — contrato de promoção independente

**Estado atual:** preparação fail-closed. Os workflows versionados existem para
validar a cadeia imutável e a configuração futura, mas não publicam, não fazem
SSH, não executam comandos remotos e não reiniciam `crm.service`.

## Fluxos canônicos

| Superfície | Workflow | Efeito atual |
| --- | --- | --- |
| Artefato/processo de Atendimento | `.github/workflows/deploy-atendimento.yml` | `workflow_dispatch` em `main` somente; valida o SHA com `promotion-gate.yml`, testa a API no preview e, em staging/produção, gera preflight sanitizado antes de bloquear. |
| Disponibilidade do módulo | `.github/workflows/atendimento-availability.yml` | `workflow_dispatch` em `main` somente; mantém a mesma cadeia SHA/evidência e valida o contrato do arquivo de controle antes de bloquear. |

O preview produz evidência somente depois da validação local do artefato. Não há
evidência de staging nem produção enquanto o executor nativo dedicado não
existir; portanto um run de preflight nunca prova publicação ou disponibilidade.

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

O único wrapper de Actions atual é
`.github/scripts/atendimento-deployment-contract.mjs`: ele compara esses
identificadores, grava evidência sem valores de variáveis e nunca chama `eval`,
`bash -c`, SSH, `systemctl` ou um comando vindo do Environment. O executor
nativo futuro deve implementar a mesma allowlist por meio de um binário/script
fixo instalado fora do checkout mutável; não se deve interpretar os valores
dessas variáveis como comandos.

## Configuração externa que ainda falta

Nos Environments GitHub separados `staging` e `production`, configurar somente
os nomes abaixo com os valores específicos de cada ambiente:

| Variável | Contrato |
| --- | --- |
| `ENABLE_ATENDIMENTO_DEPLOY` | `false` por padrão; somente `true` permite que o preflight avance até o bloqueio do executor. Não ativa módulo por si só. |
| `CRM_MODULE_CONTROL_FILE` | Exatamente `/etc/skincos/atendimento/module-control.json`. |
| `CRM_ATENDIMENTO_DEPLOY_COMMAND` | Identificador `atendimento-release-deploy-v1`. |
| `CRM_ATENDIMENTO_ROLLBACK_COMMAND` | Identificador `atendimento-release-rollback-v1`. |
| `CRM_ATENDIMENTO_CONTROL_COMMAND` | Identificador `atendimento-module-control-v1`. |
| `CRM_ATENDIMENTO_HEALTH_URL` | `https://crm-staging.skincos.com.br/api/atendimento/health` em staging; `https://crm.skincos.com.br/api/atendimento/health` em produção. |

Também são pré-requisitos técnicos, ainda não comprovados:

1. um `crm-atendimento.service` isolado, com porta, banco/role e health próprios;
2. suporte efetivo e testado de `CRM_DOMAIN=atendimento` e
   `CRM_MODULE_CONTROL_FILE` no processo — hoje o servidor CRM compartilhado não
   prova esse isolamento;
3. gateway/proxy com rota para o processo isolado em staging e produção, sem
   redirecionar para `crm.service`;
4. executor nativo confiável com allowlist dos três identificadores acima,
   autoria/auditoria por SHA e sem fallback de shell ou SSH do GitHub;
5. migration remota somente aditiva, banco alvo explicitamente identificado,
   checkpoint/backup e verificação de idempotência em staging;
6. registro pré-produção do SHA candidato e do SHA de retorno, smoke autenticado
   do mesmo SHA e prova de rollback do processo isolado.

## Rollback e disponibilidade

O rollback futuro é sempre o SHA já promovido anterior: o executor deve manter
o arquivo de controle em `disabled` ou `maintenance`, repor apenas o processo
`crm-atendimento.service`, executar o health local/público e preservar dados,
ledgers e auditoria. Não deve reiniciar, parar ou reconfigurar `crm.service`,
Orb, Pages ou outros módulos. Migrations e registros comerciais permanecem
aditivos; se o dado não puder ser revertido com segurança, o rollback desliga a
escrita/controle e recupera somente de checkpoint aprovado em ambiente isolado.

Até esses pré-requisitos serem comprovados, a única interpretação correta dos
workflows é **configuração validada ou bloqueada**, nunca deploy, staging,
produção, disponibilidade ou rollback executado.
