# Rollback

All changes are isolated on `codex/admin/ux-ui-infrastructure`. Roll back by reverting its commit or removing the worktree branch before merge. Local dependencies can be rebuilt with `npm ci`; ignored `artifacts/` can be discarded locally. No deployment, database, OAuth grant, secret, workflow activation or production setting was changed.
