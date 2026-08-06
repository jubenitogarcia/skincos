# Atendimento — contrato de promoção independente

O contrato é dispatch-only, parte de `main`, exige SHA completo e predecessor
e nunca executa comando vindo de GitHub Environment. PRs antigas de separação
do worker foram superseded pela implementação atual sobre `origin/main`; não
se incorpora branch defasada.

## Superfícies e workflows

| Superfície | Workflow | Efeito |
| --- | --- | --- |
| Artefato/processo Atendimento | `.github/workflows/deploy-atendimento.yml` | `workflow_dispatch` em `main`, `promotion-gate.yml`, preview, staging e atestação do SHA imutável. |
| Disponibilidade do módulo | `.github/workflows/atendimento-availability.yml` | Mesmo encadeamento de SHA, predecessor e controle fail-closed. |

Os identificadores aceitos são semânticos e allowlisted:

| Variável | Valor |
| --- | --- |
| `CRM_ATENDIMENTO_DEPLOY_COMMAND` | `atendimento-release-deploy-v1` |
| `CRM_ATENDIMENTO_ROLLBACK_COMMAND` | `atendimento-release-rollback-v1` |
| `CRM_ATENDIMENTO_CONTROL_COMMAND` | `atendimento-module-control-v1` |

O contrato não chama `eval`, `bash -c`, SSH, `systemctl` ou shell recebido de
variável. Os scripts nativos são versionados e operam apenas a unidade
Atendimento. `crm.service`, Orb, Pages e outros módulos não são reiniciados.
O staging de produção usa `prepare-atendimento-production-release.sh`, que
recusa qualquer SHA diferente do `origin/main` atual e grava o predecessor no
marcador imutável.

## Valores por ambiente

| Variável | staging | production |
| --- | --- | --- |
| `ENABLE_ATENDIMENTO_DEPLOY` | `true` após staging verde | `false` até o gate humano mínimo |
| `CRM_MODULE_CONTROL_FILE` | `/etc/skincos/atendimento/module-control.json` | `/etc/skincos/atendimento-production/module-control.json` |
| `CRM_ATENDIMENTO_HEALTH_URL` | `https://crm-atendimento-staging.skincos.com.br/api/atendimento/health` | `https://crm-atendimento.skincos.com.br/api/atendimento/health` |

A Pages Function usa `ATENDIMENTO_API_TARGET` dedicado e
`ATENDIMENTO_ACTOR_SIGNATURE_VERSION=2`. A chave
`ATENDIMENTO_ACTOR_HMAC_KEY` deve ser a mesma no Pages e no env nativo; nonce,
timestamp, método e caminho entram na assinatura. O health público não exige
login e retorna somente campos sanitizados; o readiness permanece interno.

## Primeira promoção

Produção inicia em read-only: `CRM_ATENDIMENTO_READ_ONLY=true`,
`CRM_ATENDIMENTO_CLIENTES_ONLY=true`,
`CRM_ATENDIMENTO_COMMERCIAL_WRITES_ENABLED=false`, canário vazio e nenhuma
gravação comercial, consentimento, contato, mensagem, campanha ou decisão de
identidade. A validação sintética usa apenas IDs artificiais e compara o
health/readiness do mesmo SHA promovido.

## Rollback e evidência

Antes de qualquer aplicação há backup do config/controle e snapshot custom do
schema fonte. O target de banco existente é recusado para impedir sobrescrita.
Rollback usa exclusivamente `/opt/skincos/releases/<sha>/source` já staged,
preserva o banco e deixa o controle em maintenance se health falhar. A prova
inclui predecessor (SHA atual ancestral de `origin/main`), PID/timestamp do
`crm.service` antes/depois, health público sem PII, readiness 503 durante
indisponibilidade de banco e smoke assinado com replay rejeitado.

Enquanto `ENABLE_ATENDIMENTO_DEPLOY=false`, o workflow permanece bloqueado. A
ação humana mínima é fornecer o UUID/JSON do túnel dedicado, o certificado
Cloudflare para criar o DNS fixo, alinhar a chave HMAC v2 entre Pages e o env
nativo, e só então configurar no Environment `production` o booleano e os
valores dedicados de controle/health. Nenhuma escrita comercial é aberta por
essa configuração.
