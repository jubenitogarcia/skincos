# Operations

## Local and isolated validation

Regenerate and validate from `orb/engine`:

```bash
npm run workflow:music:build
npm run workflow:music:validate
npm run workflow:music:test
npm run workflow:music:dry-run
npm run workflow:music:migration-test
npm run workflow:music:n8n-import-test
```

The import validator creates a temporary n8n SQLite profile, imports the
one-item package, exports it back, confirms one inactive workflow and removes
the profile. The migration validator creates a uniquely named temporary
PostgreSQL database, applies the migration twice, tests FK/rollback behavior
and removes the database.

## Controlled rollout

1. Record the immutable release SHA and current live Orb/database checkpoint.
2. Back up PostgreSQL and prove the restore path in a non-production target.
3. Apply the additive migration to staging.
4. Import `generated-workflows/music-composition-studio/package.json`; verify
   exactly one inactive workflow.
5. Configure provider endpoint/model and credentials outside Git.
6. Run synthetic FAST/STANDARD/PREMIUM mock journeys and callback/idempotency,
   cost, rights and rollback checks.
7. Activate only after explicit production authorization.

Rollback disables/archives the unified workflow and provider access. Ledger
history is retained for audit; tables are not deleted. The workflow has no
publication action.
