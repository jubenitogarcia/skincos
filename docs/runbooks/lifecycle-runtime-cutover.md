# Lifecycle runtime cutover

This runbook moves active mutable state into the lifecycle layout without
deleting the legacy tree during the change window. It is intentionally separate
from the source-layout pull request: a merged path move is never proof that a
service is safe to rename.

## Preconditions

1. The source PR is merged, the canonical checkout is fast-forwarded, and all
   required CI checks are green.
2. A detached rollback worktree exists at the last known-good main commit. Keep
   it until a post-cut verified backup and public smoke are complete. A clean
   worktree is source-only: stage the legacy Livia workflow and CRM production
   dependencies under `C:\CodexRuntime\artifacts\runtime-cutover\<timestamp>`;
   do not put runtime state or dependencies into Git.
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

On this Windows host, lifecycle copies under `C:\CodexRuntime` use native
`robocopy` by default. It prevents WSL/DrvFS copy stalls while preserving the
pre-copy rule (copy only missing files); final sync copies changed files but
never deletes a legacy source or destination-only artifact. Set
`LIFECYCLE_SYNC_TRANSPORT=rsync` only for a non-Windows runtime or an explicit
diagnostic.

The pre-copy also transfers the active Livia workflow from the retained legacy
source into `C:\CodexRuntime\state\orb\workflows`. The lifecycle Orb unit and
the official validator read this runtime location; no workflow state is copied
into the new checkout.

At the window, first stage and verify the non-Git rollback artifacts while
legacy services are still healthy. This is non-disruptive and creates only
runtime artifacts plus symlinks in the retained rollback worktree:

```bash
scripts/runtime/stage-rollback-artifacts.sh \
  --rollback-root /mnt/c/CodexShared/Worktrees/skincos/admin/runtime-cutover-rollback \
  --artifact-root /mnt/c/CodexRuntime/artifacts/runtime-cutover/<timestamp>
```

Use a new timestamped artifact directory for every attempted cut. The staging
helper refuses to overwrite a prior rollback bundle or an existing worktree
link that points elsewhere. If a prior recovery left an older symbolic link in
the worktree, verify the new timestamped bundle and add
`--replace-rollback-links`; this can replace symbolic links only, never a
regular file or directory.

Then use the real backup directory, retained worktree and the exact staged
artifact directory:

```bash
scripts/runtime/cutover-lifecycle-runtime.sh \
  --backup-dir /mnt/c/CodexRuntime/n8n/backups/daily/<timestamp> \
  --rollback-root /mnt/c/CodexShared/Worktrees/skincos/admin/runtime-cutover-rollback \
  --rollback-artifact-root /mnt/c/CodexRuntime/artifacts/runtime-cutover/<timestamp>

scripts/runtime/cutover-lifecycle-runtime.sh --apply \
  --backup-dir /mnt/c/CodexRuntime/n8n/backups/daily/<timestamp> \
  --rollback-root /mnt/c/CodexShared/Worktrees/skincos/admin/runtime-cutover-rollback \
  --rollback-artifact-root /mnt/c/CodexRuntime/artifacts/runtime-cutover/<timestamp>
```

The apply command captures all old unit files, stops only the seven legacy
units, makes the final non-destructive data sync, installs and starts `orb`,
`orb-proxy`, `messaging-whatsapp`, `crm`, `booking`, `cloudflare-orb` and
`cloudflare-runtime`. It requires local Orb health plus public Orb and CRM
health. Legacy stop/start operations are asynchronous but bounded; a timeout
causes rollback instead of leaving the operator waiting indefinitely. A failed
post-stop step restores the captured units with paths rewritten to the retained
rollback worktree and restarts the legacy services. The dry-run refuses to
continue unless its runtime artifact links resolve to the staged bundle.

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
