# SKINCOS development storage governance

This runbook governs local development storage on Windows. It is separate from
production release custody and never mutates the WSL VHDX, `SKINCOS_STAGING`,
the canonical checkout, or Codex session files directly.

## Policy

The versioned policy is `ops/codex/storage-retention-policy.json`. Its default
thresholds are warning at 100 GB free, high at 50 GB, critical at 25 GB and
emergency at 10 GB. New cleanup behavior is dry-run unless an operator invokes
`-Apply` explicitly.

The private runtime stores reports and action history at:

`C:\CodexRuntime\operator\admin\skincos\storage-governance`

It must not be placed in the shared checkout.

## Modes

```powershell
# Quick report; no mutation
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\skincos-storage-governance.ps1 -Mode audit

# Focal inventory for the active project and release roots, without Git status
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\skincos-storage-governance.ps1 -Mode audit -IncludeFocalArtifacts

# Focal inventory including worktrees, source archives and workerd paths
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\skincos-storage-governance.ps1 -Mode audit -IncludeFocalArtifacts -IncludeWorktreeFocalArtifacts

# Full targeted inventory, including worktrees, source archives and workerd paths
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\skincos-storage-governance.ps1 -Mode audit -Deep -IncludeWorktreeStatus

# Dry-run of allowlisted temporary cleanup
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\skincos-storage-governance.ps1 -Mode cleanup

# Official Codex session lifecycle; audit first
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\codex-session-retention.ps1 -Mode audit
```

`cleanup` only considers expired files in the allowlisted `%TEMP%` and npm
`_npx` roots. `C:\Temp`, `C:\tmp`, pnpm stores, SKINCOS runtime caches and
builds are report-only until a narrower owner-specific rule is validated.

## Worktree lifecycle

`new-shared-worktree.ps1` records owner, task, branch, commit, timestamps,
status, pin and lease fields in the private lifecycle directory. CRM Local
private source worktrees register the same metadata. The classifier also reads
the first `session_meta` line from active Codex JSONL sessions and blocks a
worktree whose path is an active session `cwd`. A worktree is eligible for
regenerable cleanup only when it is clean, merged into `origin/main`, outside
protected rollback paths, has no associated process/session and is not pinned
or leased.

Use `close-shared-worktree.ps1` for a dry-run classification. It must never be
replaced by `git clean -fdx`, recursive directory deletion or an unreviewed
`git worktree prune`. The governance cleanup mode removes only the outermost
`node_modules`, `dist`, `.vite`, `.next`, `.turbo`, `coverage` and
`playwright-report` directories from eligible worktrees. Worktree removal is a
separate opt-in (`-AllowWorktreeRemoval`) and is disabled by default.

Install the read-only monitor after validating the worktree path used by the
task:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\install-skincos-storage-governance-task.ps1 `
  -RepositoryRoot (Get-Location).Path `
  -ScriptPath (Join-Path (Get-Location).Path 'scripts\skincos-storage-governance.ps1') `
  -IntervalHours 6 -Apply
```

The registered task runs `-Mode audit -IncludeFocalArtifacts` by default. This
keeps `source.tar` and active-project `workerd*` visible without invoking Git
status and merge-base checks for every registered worktree. Cleanup and hardlink
deduplication remain explicit operator actions. Worktree artifact scanning and
detailed worktree classification should be run explicitly when needed. The
scheduled focal scan records archive metadata without rehashing all archive
bytes; use `-Deep` when SHA-256 recomputation is required:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\install-skincos-storage-governance-task.ps1 `
  -RepositoryRoot (Get-Location).Path `
  -ScriptPath (Join-Path (Get-Location).Path 'scripts\skincos-storage-governance.ps1') `
  -IncludeWorktreeStatus -Apply
```

## Release archives

`dedupe-source-tars.ps1` hashes the bounded release, checkpoint and snapshot
roots and only
considers exact SHA-256 and byte-size duplicates. With explicit hardlink mode,
it preserves every original path, quarantines the duplicate transactionally,
creates a hardlink to the canonical artifact, verifies the hash and link list,
and removes the temporary quarantine copy. Different ACLs, volumes, recent
files and reparse points are blocked.

This preserves rollback path names while avoiding repeated physical content.
The operation is idempotent: a later scan reports an existing canonical
hardlink as `already-hardlinked` and does not move it again. It does not expire
releases or checkpoints automatically; those remain pinned until a
release-custody manifest supplies an explicit retention decision.

## Codex sessions

Codex CLI 0.144.4 provides the supported `archive`, `unarchive` and `delete`
commands. `codex-session-retention.ps1` uses those commands rather than
editing JSONL or SQLite files. Active sessions are always protected; deletion
requires the archived-session TTL and never runs for pinned IDs.

## WSL

Use `scripts/storage/audit-wsl-readonly.sh` through the typed WSL gateway with
`WSL_BOUNDARY_EXCEPTION=storage-readonly-audit`. It is a diagnostic probe only.
No compaction, unregister, repair or VHDX deletion is permitted until backup,
filesystem consistency and internal consumer analysis are complete.
