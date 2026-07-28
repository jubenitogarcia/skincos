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
