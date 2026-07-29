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
candidata e publique exclusivamente pela transação versionada:

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
(`https://orb.skincos.com.br/healthz`). Uma nova versão histórica de Livia não
requer restart. Se uma promoção de ponteiro global for excepcionalmente
necessária, use somente `scripts/runtime/promote-native-source-release.sh`;
ele cria a janela de manutenção, aguarda execuções ativas e verifica o CWD do
Orb. Nunca use `systemctl restart orb.service` diretamente.

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
