# Pacote de mudança Orb/n8n

Este diretório contém somente automações, fixtures sintéticas, manifesto e
runbooks. O pacote não contém backup, dump, segredo ou log sensível.

Estado da evidência de origem: `BLOQUEADO`. O staging provou bootstrap direto de
2.32.5, OAuth sintético, gateway readonly e rollback para 2.8.3, mas ainda não
provou as jornadas end-to-end, MCP OAuth contra o candidato, falha injetada e
persistência WSL/keepalive. Por isso os scripts não devem ser usados para
promoção até nova aprovação humana.

## Uso seguro

Todos os scripts exigem `N8N_UPGRADE_ENV` e `N8N_EXPECTED_ENV`; staging também exige
`N8N_STAGING_MARKER=orb-n8n-staging`. O padrão é dry-run. Operações mutáveis
exigem `N8N_UPGRADE_APPLY=YES`, aprovação do ambiente e, em produção,
`N8N_PRODUCTION_CHANGE_APPROVED=YES` e `N8N_APPROVAL_ID`. Senhas/tokens/cookies
em argumentos são recusados; o bearer MCP é lido de arquivo privado.

```bash
export N8N_UPGRADE_ENV=staging
export N8N_EXPECTED_ENV=staging
export N8N_STAGING_MARKER=orb-n8n-staging
export N8N_DRY_RUN=1
ops/runtime/n8n-upgrade/tests/test-scripts.sh
```

O script `upgrade.sh` nunca usa tag flutuante: requer tarball local e confere a
integridade SHA-512 do manifesto. `migrate.sh` exige binário que reporte 2.32.5.
`rollback.sh` não implementa downgrade de schema; exige restore-verified e para
com falha fechada se isso não estiver explicitamente comprovado.

## Comparação de dependências

`audit-dependency-baseline.sh` gera um fixture privado, sintético e não
executável, com `npm install --package-lock-only` seguido de `npm ci`, sempre
com Node 22.23.1, npm 10.9.8, Linux/x64, `--ignore-scripts` e `--omit=optional`.
Ele fixa no relatório a árvore e cada advisory high/critical com a cadeia de
introdução e o URL primário. A opção `N8N_AUDIT_INCLUDE_LEGACY_EVOLUTION=1`
audita adicionalmente a baseline exata de produção, que ainda contém o pacote
Evolution redundante; a comparação principal usa os mesmos 9 packages alvo em
todas as versões. Os relatórios ficam somente no diretório privado definido em
`N8N_AUDIT_ROOT`; `compare-dependency-baselines.mjs` não oculta advisories e
apenas produz a matriz para classificação humana.
