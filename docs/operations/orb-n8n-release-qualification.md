# Qualificação de release Orb/n8n

Este pacote é preparatório. Ele não instala, atualiza, promove, reinicia, executa migration nem acessa o runtime de produção.

## Uso permitido

Execute o auditor somente em um staging marcado explicitamente e em um diretório Linux privado fora de `/opt`, `/etc` e `/var/lib`:

```bash
N8N_UPGRADE_ENV=staging N8N_EXPECTED_ENV=staging \
N8N_STAGING_MARKER=orb-n8n-staging N8N_AUDIT_APPLY=YES \
N8N_AUDIT_ROOT=/tmp/n8n-release-audit \
bash ops/runtime/n8n-security/audit-release-baseline.sh 2.32.5
```

Compare versões por meio de seus `summary.json`. A comparação de advisories não comprova alcançabilidade; cada item crítico requer uma matriz separada de origem, pré-condição, superfície externa, workflow e evidência de teste negativo.

## Observador de releases estáveis

`watch-stable-release.sh` consulta exclusivamente a tag `stable` do registry
oficial, recusa uma tag pré-release e registra `next`/beta somente como
informação ignorada. Ele compara a versão com
`ops/runtime/n8n-security/release-watch-policy.json`; se houver uma release
estável mais nova, gera lockfiles exclusivamente a partir de
`https://registry.npmjs.org/`, executa o auditor isolado e produz um relatório
sanitizado no diretório privado. `REJECTED_CRITICAL_DEPENDENCY_GATE` e
`REJECTED_AUDIT_ERROR` encerram a sequência antes de startup, migration ou
qualquer alteração live. Um relatório íntegro já existente é reutilizado de
forma idempotente.

```bash
N8N_UPGRADE_ENV=staging N8N_EXPECTED_ENV=staging \
N8N_STAGING_MARKER=orb-n8n-staging N8N_RELEASE_WATCH_APPLY=YES \
N8N_AUDIT_ROOT=/var/tmp/skincos-n8n-release-watch \
bash ops/runtime/n8n-security/watch-stable-release.sh
```

O observador não atualiza a política, não executa a qualificação funcional
completa, e nunca faz merge, deploy, restart, migration ou acesso a caminhos de
produção. Um candidato sem críticos apenas fica marcado para a qualificação
isolada completa já controlada pelo PR de upgrade draft.

O workflow agendado `.github/workflows/orb-n8n-stable-release-watch.yml` roda
diariamente em runner efêmero, sem secrets e com permissão `contents: read`.
Ele usa o mesmo marcador de staging sintético, Node.js `22.23.1`, npm `10.9.8`
e o registry npm oficial. Seu diretório de auditoria é `/tmp` do runner, não um
caminho de runtime da SKINCOS. Ele publica somente o relatório sanitizado e lockfiles
de auditoria como artefato temporário; não altera a política, não abre ou faz
merge de PR, não promove nem acessa o runtime de produção.

## Gate de promoção

Uma promoção futura requer, além deste inventário: release estável oficial, checksum fixado, staging completo, backup/restauração comprovados, migrations reversíveis por restauração, regressão OAuth, MCP somente leitura, quatro serviços e bloqueio público de MCP. Qualquer vulnerabilidade crítica com caminho alcançável ou não descartado bloqueia a promoção.

## Inventário

O inventário mantém somente `n8n-nodes-evolution-api-en`, a variante observada como gerenciada. A variante legada em português e `n8n-nodes-python` ficam explicitamente excluídas; a reintrodução exige evidência de uso, qualificação isolada e revisão humana.
