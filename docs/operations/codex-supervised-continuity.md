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
- Per-mission cycle budget: eight continuations by default. A fresh explicit
  user turn (`stop_hook_active=false`) starts a new budget; generated turns do
  not.
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

The tests use only temporary state and synthetic Stop payloads. A real proof
must use a disposable checkout and a small reversible non-production objective,
show one automatic generated turn, one real technical validation, a terminal
contract and no manually submitted second prompt.

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
