# Livia: promoção, rollback e retenção isolados

## Pré-condições e checkpoint

1. Registre a autorização do operador, o SHA candidato, o risco e o
   `workflowVersion` ativo. Não promova durante uma execução Livia em
   `new`, `running` ou `waiting`.
2. Crie um checkpoint privado do workflow/histórico, manifesto, ledger,
   estado do Drive, IDs externos e release ativa; gere e confira o
   `SHA256SUMS` antes de qualquer escrita.
3. No Windows, gere o archive e a linhagem do commit revisado, calcule os dois
   SHA-256 e copie ambos para uma área nativa Linux. Nunca use `/mnt/c` como
   origem do runtime.

## Estágio e publicação

Com os artefatos reais do passo 3 já em armazenamento Linux, o estágio é
executável somente com todos os parâmetros abaixo:

```bash
export SKINCOS_RELEASE_ID='<merge-commit-40-hex>'
scripts/runtime/prepare-native-source-release.sh \
  --archive /var/tmp/livia-"$SKINCOS_RELEASE_ID"-source.tar \
  --sha256 '<archive-sha256-64-hex>' \
  --lineage /var/tmp/livia-"$SKINCOS_RELEASE_ID"-lineage.json \
  --lineage-sha256 '<lineage-sha256-64-hex>' \
  --apply --stage-only
```

O comando valida o construtor, a matriz offline e os entrypoints antes de criar
`/opt/skincos/releases/$SKINCOS_RELEASE_ID/source`; ele não muda
`/opt/skincos/current/source`. Em seguida, gere o manifesto da versão
candidata pelo construtor único e valide o grafo produzido. Não aplique patches
isolados manualmente: o construtor inclui, como unidade atômica de candidato,
o catálogo comercial oficial CRM read-only, as marcas Drive por fonte, o
preflight do Token Vault, o contrato de alt text, o contrato de carrossel
Facebook e o pin/runtime semanticamente idempotente. O patch comercial valida
que a tool usa GET/Bearer sem placeholder, que `bss` e `nh` são derivados de
`Get Credential Tokens`, que Documents permanece editorial e que `crmPricing`
falha fechado fora de `crm|none`.

```bash
sudo -u postgres node /opt/skincos/releases/"$SKINCOS_RELEASE_ID"/source/orb/engine/scripts/prepare-livia-production-candidate.js \
  --input /var/tmp/livia-live-export.json \
  --output /var/tmp/livia-candidate.json \
  --release-root /opt/skincos/releases/"$SKINCOS_RELEASE_ID"/source/orb/engine
sudo -u postgres node /opt/skincos/releases/"$SKINCOS_RELEASE_ID"/source/orb/engine/scripts/validate-livia-workflow.js \
  /var/tmp/livia-candidate.json
sudo node /opt/skincos/releases/"$SKINCOS_RELEASE_ID"/source/orb/engine/scripts/livia/qa-runner.js \
  validate
```

O `qa-runner` precisa ser executado a partir do bundle candidato, não do
checkout compartilhado nem de uma release anterior. Ele é somente leitura e
deve reprovar contratos editoriais, de acessibilidade ou de preflight que não
correspondam à versão que será promovida.

Antes da escrita versionada, faça o smoke autenticado read-only do CRM com o
token protegido já carregado no runtime. O endpoint deve aceitar apenas Bearer,
retornar `crm-commercial-catalog/v1`, conter as duas chaves CRM solicitadas e
não executar mutação:

```bash
CRM_CATALOG_TOKEN="${CRM_COMMERCIAL_CATALOG_TOKEN:-${META_ADS_OFFER_CONTEXT_TOKEN:-}}"
test -n "$CRM_CATALOG_TOKEN"
curl --fail-with-body --silent --show-error \
  -H "Authorization: Bearer $CRM_CATALOG_TOKEN" \
  'http://127.0.0.1:8099/api/atendimento/internal/commercial/catalog?units=barra-shopping-sul,novo-hamburgo'
```

Não registre o valor do token nem o response bruto em artefatos compartilhados.

Somente então gere o manifesto da versão candidata e publique exclusivamente
pela transação versionada:

```bash
sudo -u postgres node /opt/skincos/releases/"$SKINCOS_RELEASE_ID"/source/orb/engine/scripts/workflow-runtime-manifest.js \
  create --workflow /var/tmp/livia-candidate.json \
  --workflow-id WGXr4vYkv9UoJ8zc --workflow-version '<new-workflow-uuid>' \
  --release-root /opt/skincos/releases/"$SKINCOS_RELEASE_ID"/source/orb/engine
sudo -u postgres node /opt/skincos/releases/"$SKINCOS_RELEASE_ID"/source/orb/engine/scripts/apply-livia-runtime-isolation.js \
  /var/tmp/livia-candidate.json --expected-version='<previous-workflow-uuid>' \
  --next-version='<new-workflow-uuid>' \
  --release-root=/opt/skincos/releases/"$SKINCOS_RELEASE_ID"/source/orb/engine \
  --manifest-precreated --apply
```

Depois, rode `workflow-runtime-manifest.js audit-live`, confira os hashes dos
entrypoints e os healthchecks local (`http://127.0.0.1:5678/healthz`) e público
(`https://orb.skincos.com.br/healthz`), e execute novamente o `qa-runner`
diretamente do bundle promovido. Uma nova versão histórica de Livia não
requer restart. Se uma promoção de ponteiro global for excepcionalmente
necessária, use somente `scripts/runtime/promote-native-source-release.sh`;
ele cria a janela de manutenção, aguarda execuções ativas e verifica o CWD do
Orb. Nunca use `systemctl restart orb.service` diretamente.

### Contrato do verificador

`Verify Published Artifacts` deve chamar diretamente
`/opt/skincos/releases/<release>/source/orb/engine/scripts/livia/verify-published-artifacts.js`
via stdin. A promoção deve recusar o candidato se esse comando contiver
`/opt/skincos/current`, `ORB_ROOT`, `N8N_ROOT`, `/mnt/c`, um wrapper externo,
ou `--verifier`. Não introduza wrapper para aceitar `caption_mismatch`: uma
divergência de legenda é falha causal e deve bloquear Drive, notificações e
cleanup de sucesso até a evidência do provedor ser reconciliada no verificador
versionado.

### Replay offline do grafo de publicação

Para conferir uma execução histórica sem chamar o gateway, use o `qa-runner`
da própria release imutável:

```bash
sudo node /opt/skincos/releases/<release-40-hex>/source/orb/engine/scripts/livia/qa-runner.js \
  replay-build-graph --execution '<execution-id>'
```

O runner fixa `LIVIA_BUILD_JOB_GRAPH_SOURCE` em
`/opt/skincos/releases/<release-40-hex>/source/orb/engine/compose2-current.js`.
Ele não pode herdar `/opt/skincos/current`, `ORB_ROOT`, `N8N_ROOT` nem procurar
o antigo Code node. Confirme no resultado a quantidade/fases dos jobs, a
`coverUrl` de Instagram e o contrato de acessibilidade de Threads; uma falha
ou qualquer tentativa de gateway invalida o replay.

## Rollback de workflow

O rollback é uma nova versão histórica, nunca uma edição do banco nem a
remoção do bundle. Antes de iniciar, confirme que não há execução Livia ativa,
reconstrua o candidato diretamente da versão histórica preservada e valide seu
manifesto. O `target-version` é a versão histórica anterior registrada no
checkpoint; não selecione uma versão pelo índice da lista.

```bash
sudo -u postgres psql -d n8n_runtime -At -c "
  SELECT json_build_object(
    'id', w.id, 'name', h.name, 'active', true, 'nodes', h.nodes,
    'connections', h.connections, 'settings', w.settings, 'meta', w.meta,
    'description', h.description
  )
  FROM n8n_runtime.workflow_history h
  JOIN n8n_runtime.workflow_entity w ON w.id=h.\"workflowId\"
  WHERE h.\"workflowId\"='WGXr4vYkv9UoJ8zc'
    AND h.\"versionId\"='<target-version-from-checkpoint-uuid>'
" > /var/tmp/livia-rollback-candidate.json
sudo -u postgres node /opt/skincos/releases/<previous-release-40-hex>/source/orb/engine/scripts/workflow-runtime-manifest.js \
  create --workflow /var/tmp/livia-rollback-candidate.json \
  --workflow-id WGXr4vYkv9UoJ8zc --workflow-version '<rollback-workflow-uuid>' \
  --release-root /opt/skincos/releases/<previous-release-40-hex>/source/orb/engine
sudo -u postgres node /opt/skincos/releases/<previous-release-40-hex>/source/orb/engine/scripts/apply-livia-runtime-isolation.js \
  /var/tmp/livia-rollback-candidate.json --expected-version='<failed-active-workflow-uuid>' \
  --next-version='<rollback-workflow-uuid>' \
  --release-root=/opt/skincos/releases/<previous-release-40-hex>/source/orb/engine \
  --manifest-precreated --apply
```

Aceite o rollback somente após `audit-live`, hashes, healthchecks e uma
verificação de que o ledger não retomará por posição. Preserve a versão
problemática, o checkpoint e logs para diagnóstico.

## Retenção e retomada

Antes de qualquer cleanup, rode:

```bash
scripts/runtime/assert-workflow-runtime-retention.sh --candidate-delete '<release-40-hex>'
```

O comando recusa a exclusão de toda release referenciada por qualquer manifesto
de workflow. Só retire manifestos/histórico por um processo explícito de
desativação ou repin; o fato de uma release não ser o ponteiro global atual não
autoriza sua remoção.

Retomadas exigem `semanticJobKey`; `publishRunIndex` serve apenas para
dependências dentro da fila. Registros legados ou sem identidade semântica não
podem suprimir jobs atuais.
