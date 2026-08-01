# Codex supervised continuity

## Architecture and boundary

The project uses the smallest supported same-thread loop:

`Stop -> deterministic project gate -> $skincos-project-orchestrator
supervisor-cycle -> structured state -> Stop`

The hook parses state, enforces mechanical safety and either allows Stop or
returns the official `decision=block` continuation. It does not inspect business
systems, choose milestones, run deploys or duplicate the Skill's judgment.

Automatic continuation is opt-in per explicit root mission: the assistant must
emit the delimited supervisor contract. Ordinary answers without the contract
finish normally. Only `orchestration_status=continue` can create a new turn.
All other statuses and every ambiguous or corrupt state finish safely with a
diagnostic.

No App Server or daemon is needed for this same-thread use case. A future
multi-thread supervisor, if justified, belongs in a separate PR and must use the
official App Server with authentication, durable goals, idempotency, locks,
observability and a documented service lifecycle.

## Mechanical protections

- Event idempotency key: SHA-256 of `session_id`, `turn_id` and the SHA-256 of
  `last_assistant_message`.
- Per-session exclusive lock with PID, host and timestamp metadata. A same-host
  dead lock or expired remote lock is quarantined, never blindly deleted.
- Continuation is progress-based: a changed measurable-progress or blocker
  fingerprint is required before another turn. The 64-cycle limit is an
  emergency-only guard, not the normal pacing mechanism; a repeated fingerprint
  stops with a focal-diagnosis/different-approach instruction.
- Two-second cooldown and one-hour milestone leases. Leases live under the Git
  common directory so sibling worktrees cannot automatically take the same
  `next_item`.
- Project runtime state is ignored under `.codex/runtime/supervisor/`; shared
  worktree coordination is untracked under `.git/codex-supervisor/`.
- The installed Skill content must match the project Skill content before the
  gate continues.
- A continued Stop without recoverable mission state, invalid JSON, missing
  fields, no progress, missing next item, corrupt state or internal error
  safely ends instead of starting work.
- SessionStart, PreCompact, PostCompact and SessionEnd lifecycle hooks record
  sanitized hashes and compaction checkpoints under ignored `.codex/runtime/`
  state; prompt content and credentials are never persisted.
- The gate never executes project or production commands. Its generated prompt
  explicitly preserves the original authorization boundary.

The existing global Stop hook remains independent. Codex can run multiple
matching hooks concurrently; this gate's event idempotency and session lock
ensure that duplicate project-gate invocations produce at most one
continuation. Do not remove or replace the global hook.

## Configuration and trust

The versioned registration is `.codex/hooks.json`; conservative defaults are in
`.codex/supervisor.json`. Codex loads project hooks only from a trusted project
configuration layer and requires review of the exact command hash. Review it
with `/hooks` or the Codex App hook settings. Do not bypass that review for
normal App operation, and expect any future command hash change to require a
new review.

Trust and enablement are separate App controls. **Trust** persists the reviewed
command as `trusted_hash`; it does not necessarily enable the hook. In
`/hooks`, also turn on `SKINCOS supervised continuity` and confirm that the
matching entry under `[hooks.state]` in the user `config.toml` contains both
the current `trusted_hash` and `enabled = true`. A trusted entry without
`enabled = true` is not acceptance evidence: the real proof must still show a
`block_and_continue` event and an automatically generated second turn.

After a Trust/Enable review or a trusted-hook command update, fully close and
reopen the Windows Desktop App before opening the fresh interactive App session
in the standalone activation clone. A new top-level chat in a Desktop process
that was already running is not evidence that its in-memory project-hook
registry reloaded the current configuration. A background follow-up sent to an
already-existing thread is not a substitute for that fresh interactive App
session.

If that session emits a valid `continue` contract but its thread has no
project Stop-hook event and no generated second turn, classify the result as
`app_hook_not_loaded`; preserve the thread/turn identifiers, sanitized
evidence, and the reversible marker as frozen failure evidence, then do not
retry the same session. A global Stop-hook event alone does not establish that
the project hook was loaded. The acceptance check is intentionally strict:

```powershell
python .\scripts\validate-codex-app-proof.py <sanitized-evidence.json>
```

It accepts only two `turn.started`/`turn.completed` pairs, an observed
`block_and_continue` event, no manually submitted second prompt, the real
`supervisor-cycle`, and verified artifact cleanup. A one-turn result must stay
an explicit integration defect until a fresh session proves the complete loop.

The registered host commands resolve the runner only from the physical parent
of `git rev-parse --path-format=absolute --git-common-dir`. They require the
common directory to be a real `.git` directory, use the exact
`.codex/hooks/invoke-skincos-supervisor.*` path under that canonical root and
refuse symlink or reparse-point redirection in the trusted path. They never
search upward from `PWD`. If Git cannot establish that root or any path
invariant fails, the hook returns a safe terminal diagnostic without executing
a candidate runner.

Codex resolves project hook declarations for a linked Git worktree from the
root checkout's matching `.codex/` directory, not from a hook declaration that
exists only in the linked worktree. Therefore, use worktrees for implementation
and deterministic tests, but perform App activation and the real same-thread
proof from a clean standalone clone containing the integrated commit. This
avoids copying an unmerged hook into the dirty shared root checkout and keeps
the hook source and trust state authoritative. The standalone clone must remain
secret-free and must be updated only by fast-forward from the integrated
`main`.

The active Skill is installed as a local junction:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\install-project-skill.ps1
```

When deliberately moving an existing Skill junction to a verified integrated
checkout, add `-SourceRoot <checkout> -ReplaceExistingLink`. The installer
refuses to replace a normal directory.

## Validation

Cross-platform deterministic tests:

```bash
npm run codex:supervisor:test
```

Native Windows wrapper:

```powershell
powershell -ExecutionPolicy Bypass -File .\.codex\hooks\tests\test-host-wrappers.ps1
powershell -ExecutionPolicy Bypass -File .\.codex\hooks\tests\test-rollback.ps1
powershell -ExecutionPolicy Bypass -File .\.codex\hooks\tests\test-skill-installer.ps1
```

These commands intentionally omit root overrides so Windows PowerShell 5.1 also
exercises the scripts' canonical default-root resolution.

The tests use only temporary state and synthetic Stop payloads. A real proof
must use a disposable checkout and a small reversible non-production objective,
show one automatic generated turn, one real technical validation, a terminal
contract and no manually submitted second prompt.

The host-wrapper suites exercise the registered command from both the canonical
root and nested directories. They plant homonymous intermediate wrappers and
redirected `.codex` paths (Windows junctions and Linux symlinks), verify those
candidates are never executed, verify a symlinked shell runner is refused, and
check safe termination outside a Git repository.

## Operational rollback

The controller makes rollback explicit and preserves the Skill, ledgers,
mission state and event evidence:

```powershell
# Stop automatic continuation while leaving registration in place
powershell -ExecutionPolicy Bypass -File .\scripts\manage-skincos-supervisor-hook.ps1 -Action Disable

# Remove only the project registration, preserving an exact runtime backup
powershell -ExecutionPolicy Bypass -File .\scripts\manage-skincos-supervisor-hook.ps1 -Action RemoveRegistration

# Restore the exact registration and re-enable the gate
powershell -ExecutionPolicy Bypass -File .\scripts\manage-skincos-supervisor-hook.ps1 -Action RestoreRegistration

# Re-enable after a simple Disable
powershell -ExecutionPolicy Bypass -File .\scripts\manage-skincos-supervisor-hook.ps1 -Action Enable
```

`Status` reports registration, backup, enablement and preserved runtime state.
After restore, rerun the synthetic gate and wrapper tests. Removing or restoring
the exact same registration preserves its hash; editing the command requires a
new Codex trust review.
