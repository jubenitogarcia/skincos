# Orb decisions

The repository root `DECISIONS.md` is authoritative.

- Orb runs from immutable native releases, never a checkout or DrvFS.
- Mutable state, secrets, logs and backups use their native lifecycle roots.
- Only system-scoped final units are supported; user services and migration
  launchers are retired.
- Workflow patchers already applied to the database are not retained as
  operational commands; Git history preserves their audit trail.
- The Windows task is the sole backup scheduler and may publish only a
  restore-verified native snapshot.
- Clinic workflows remain inactive until their product-owned Calendar contract
  and safe test data are explicitly confirmed.
