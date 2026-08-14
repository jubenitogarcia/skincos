# Influencer Intelligence — governed staging migrations

This runbook covers only the additive PostgreSQL artifacts under
`social/influencer-intelligence/migrations/`. It does not register the module,
enable `INFLUENCER_INTELLIGENCE_ENABLED`, start Orb collection, call Meta,
grant CRM access, or touch production.

## Admission contract

The database operation is admitted by the native wrapper
`scripts/runtime/run-influencer-intelligence-staging-migration.sh`, which
accepts only a full SHA and resolves the runner from
`/opt/skincos/releases/<sha>/source`. It requires the immutable
`.skincos-global-coordination-influencer-intelligence.json` attestation and a
global staging mutation lease before an apply. The wrapper creates the
checkpoint only below
`/var/backups/skincos/influencer-intelligence/staging/`; callers cannot choose
the destination. The underlying fixed runner is
`scripts/staging/influencer-intelligence-migration.mjs`. It reads the database URL only from the native private file
`/etc/skincos/crm-atendimento-staging-migrator.env`, the canonical staging
database migrator custody already used by the CRM; no analytics-specific copy
of the password is created. The file is not in Git and its value is never
printed. The URL must point to loopback TLS,
`skincos_staging`, and `skincos_staging_migrator_login`. The runner overrides
the connection application name to `influencer-intelligence-migration` and
proves it from PostgreSQL.

The effective DDL role is the existing staging owner role
`skincos_staging_crm_owner`, reached only through the dedicated migrator
membership. The preflight proves database identity, session/effective role,
`CONNECT`/`CREATE` privileges and role shape. The module runtime roles
(`skincos_staging_crm_app` and `skincos_staging_crm_runtime`) must have no
usage/create/DML privilege on the new schema. No runtime grant is created by
this operation.

For the global lease, the wrapper reads only the root-owned
`/etc/skincos/global-coordination/orb-backup.env` custody file. It accepts the
legacy shared-secret record or the explicit active-key/key-id pair produced by
the dispatch-only native custody workflow, and owns the fixed mission, thread
and actor identity for this staging operation. It never accepts a coordinator
URL, secret or lease identity from command-line arguments.

## Dry-run and apply

The release process must first generate the closure from the exact reviewed
SHA and stage it with the other immutable release attestations. The closure is
module-specific; an Orb or Atendimento closure cannot be substituted:

```bash
node ./scripts/codex-global-coordinator.mjs closure \
  --module influencer-intelligence --source <full-lowercase-main-sha> \
  --result-file /var/lib/skincos-runtime/release/<sha>/influencer-intelligence-closure.json
```

For a read-only preflight, use the same native wrapper from Ubuntu-24.04 (the
private environment remains root-only):

```bash
/opt/skincos/releases/<full-lowercase-main-sha>/source/scripts/runtime/run-influencer-intelligence-staging-migration.sh \
  --dry-run --release-sha <full-lowercase-main-sha>
```

After the release SHA, closure, staging database identity, secret custody and
the explicit staging maintenance window have been independently admitted, the
native wrapper captures a unique private checkpoint and applies:

```bash
/opt/skincos/releases/<full-lowercase-main-sha>/source/scripts/runtime/run-influencer-intelligence-staging-migration.sh \
  --apply --release-sha <full-lowercase-main-sha>
```

The checkpoint is a private, hashed pre-apply schema/ledger/row-count record;
it contains no URL, password, provider credential, or raw data. The wrapper
proves the lease again after the runner returns. The runner
sets `lock_timeout=3s`, `statement_timeout=60s`, and
`idle_in_transaction_session_timeout=90s`, takes the fixed advisory lock, and
executes the allowlisted migrations in one transaction. Every migration is
recorded with its source checksum, release SHA, run ID and runner version.

The same native wrapper supports a read-only verification against the exact
release:

```bash
/opt/skincos/releases/<full-lowercase-main-sha>/source/scripts/runtime/run-influencer-intelligence-staging-migration.sh \
  --verify --release-sha <full-lowercase-main-sha>
```

The wrapper invokes `--verify --target staging`, which proves the complete
relation, ledger, append-only trigger, column, timeout and runtime-grant
contract after apply.

## Failure and rollback

Any preflight, checksum, lock, SQL or post-validation failure rolls back the
open transaction and emits only a structured redacted error. A retry is safe
only through the same runner: the advisory lock serializes attempts and the
ledger makes a matching checksum a no-op. A checksum mismatch or rolled-back
ledger row is terminal and requires operator review.

There are no destructive down migrations. If a committed additive schema must
be reverted, keep the module/runtime off, preserve the checkpoint and evidence,
and use the separately verified PostgreSQL restore procedure. Production has
no command path in this runner; staging verification, grants/off state,
rollback identity and a separate operational approval remain prerequisites for
any later production decision.
