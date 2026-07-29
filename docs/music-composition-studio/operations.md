# Operations

Import generated MSC workflows only as a new inactive package. Do not overwrite
the Campaign Creative Generator, activate an MSC workflow, apply the migration,
or configure a real provider during local validation.

For a future controlled rollout: back up PostgreSQL; apply the additive
`20260724_music_composition_studio.sql` to equivalent staging; verify
`music_studio` tables; import inactive workflows; configure credentials outside
Git; and capture dry-run, callback/idempotency, rights, cost-limit, rollback,
and smoke evidence. Rollback disables the module/workflows and retains ledger
history rather than deleting it.
