# Lifecycle runtime cutover

This runbook moves active mutable state into the lifecycle layout without
deleting the legacy tree during the change window. It is intentionally separate
from the source-layout pull request: a merged path move is never proof that a
service is safe to rename.

## Preconditions

1. The source PR is merged, the canonical checkout is fast-forwarded, and all
   required CI checks are green.
2. A detached rollback worktree exists at the last known-good main commit. Keep
   it until a post-cut verified backup and public smoke are complete.
3. `skincos-n8n-backup.service` has completed with `VERIFY_RESTORE=1`; record
   the resulting directory under `C:\CodexRuntime\n8n\backups\daily` and
   validate its manifest checksum before the cut.
4. `scripts/runtime/prepare-lifecycle-layout.sh` and
   `scripts/runtime/install-lifecycle-units.sh` both pass dry-run validation.
5. The window owner has WSL `sudo -n` access. No regular code deploy, D1
   migration or workflow save runs during the window.

## Cut sequence

Run the pre-copy before the window; it does not stop services or remove data:

```bash
scripts/runtime/prepare-lifecycle-layout.sh --apply
```

At the window, use the real backup directory and the retained worktree:

```bash
scripts/runtime/cutover-lifecycle-runtime.sh \
  --backup-dir /mnt/c/CodexRuntime/n8n/backups/daily/<timestamp> \
  --rollback-root /mnt/c/CodexShared/Worktrees/skincos/admin/runtime-cutover-rollback

scripts/runtime/cutover-lifecycle-runtime.sh --apply \
  --backup-dir /mnt/c/CodexRuntime/n8n/backups/daily/<timestamp> \
  --rollback-root /mnt/c/CodexShared/Worktrees/skincos/admin/runtime-cutover-rollback
```

The apply command captures all old unit files, stops only the seven legacy
units, makes the final non-destructive data sync, installs and starts `orb`,
`orb-proxy`, `messaging-whatsapp`, `crm`, `booking`, `cloudflare-orb` and
`cloudflare-runtime`. It requires local Orb health plus public Orb and CRM
health. A failed post-stop step restores the captured units with paths rewritten
to the retained rollback worktree and restarts the legacy services.

## After the cut

- Confirm each lifecycle unit is active and the old unit names are disabled.
- Trigger `orb-backup.service` once. It validates a PostgreSQL restore before
  retaining only the latest lifecycle backup.
- Run the official Orb validator and the local/public CRM and Orb smoke checks.
- Keep the checkpoint at
  `C:\CodexRuntime\backups\runtime-cutover\<timestamp>` and the rollback
  worktree until all checks pass. Only then may the old runtime paths, old
  timer, older backups and the rollback worktree enter retirement review.

## Secret handling

The copy helper reads no secret values to stdout. It relocates tunnel credential
files into `C:\CodexRuntime\secrets`, rewrites only the local config file path,
and applies a Windows ACL limited to `admin` and `LocalSystem`. No credential is
written to the repository or to a worktree.
