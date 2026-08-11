# Autonomous delivery standard

This is the operational summary for reversible SKINCOS delivery. The
[autonomy policy](../decisions/codex-autonomy-policy.md) decides whether the
mission authorizes an action; domain policies decide whether the action is
technically eligible. A missing technical gate is repaired or recorded as a
blocker, not converted into a repeated permission question.

## Canonical flow

1. Reconstruct only the relevant source of truth, current environment, risk,
   incumbent release, dependency closure, and rollback identity.
2. Work in an isolated `codex/admin/<task>` worktree. Preserve unrelated dirty
   checkouts.
3. Run the risk-selected focused validation and reuse the same SHA, release
   identity, closure digest, and evidence through integration and deployment.
4. Keep the PR mergeable through the `merge:main` lease. A PR carrying
   `automerge/enabled` is dispatched automatically to
   `global-merge-authority.yml` once GitHub reports it clean; the authority
   revalidates the base, head, closure, lease and required checks before the
   single merge mutation.
5. Promote only an immutable release identity. Every native mutation acquires,
   checks, renews, and releases the global lease immediately around each
   external mutation.
6. Use objective rollout evidence to move `off -> shadow -> active`. A failed
   shadow or active criterion holds the capability or returns it to the last
   safe mode; it does not wait for a human to click through a reversible gate.

For the Livia AI reel-cover lane, the versioned contract is
`ops/governance/livia-rollout-policy.json`, the database transition is
`orb/engine/scripts/livia/set-rollout-mode.js`, and the native controller is
`scripts/runtime/livia-progressive-rollout.sh`. The controller requires the
exact active workflow version, the immutable release SHA, a global lease and a
functional-smoke evidence file before activation. It changes only
`LIVIA_REEL_COVER_MODE`; it never restarts Orb or publishes to a social
platform.

## Native custody

GitHub Actions is the source of truth for the coordination secret. The trusted
mini-PC runner is the only bridge that may reconcile it to native Linux. The
runner is dispatch-only from the exact current `main` SHA, runs as
`skincos-actions`, and has one passwordless sudo command:
`/usr/local/sbin/skincos-provision-global-coordination`. That helper writes the
private `/etc/skincos/global-coordination/orb-backup.env` atomically and emits
metadata only. No workflow copies the value to the checkout, Windows, an
artifact, a comment, or a log.

The bootstrap is executable without a manual secret handoff when the operator
already has an authenticated GitHub CLI session and native root access. Run
`scripts/bootstrap-native-custody-runner.ps1`: it verifies the current runner
release and digest, requests a short-lived registration token only when the
local runner identity is absent, and sends it through the typed WSL gateway's
in-memory `StandardInputText` path. The gateway writes BOM-free UTF-8 bytes to
stdin; the token never enters a Windows-side argv value, file, log or artifact.
The upstream `config.sh` registration necessarily receives it as a short-lived
local process argument, which is not persisted or emitted. The installer
creates only the empty custody directory before starting systemd, so
`ProtectSystem=strict` remains compatible with the later workflow-owned
atomic secret write.

The routine path is
`.github/workflows/provision-native-global-coordination-custody.yml`. The
native production runner uses `SKINCOS_GLOBAL_COORDINATOR_PRODUCTION_URL`; a
staging coordinator is a separate trust plane and is never silently reused for
production custody. The
An already existing GitHub secret, staging, merge, release, shadow, active or
rollback state is not a reason for a manual interruption. Human action remains
necessary only when the authenticated GitHub session, native root/platform
trust, or a genuinely nonexistent credential is unavailable; the normal
registration, custody reconciliation and recovery path is otherwise
Codex-executable and fail-closed.

## Evidence and recovery

Evidence records the UTC time, SHA, environment, workflow/run, release or
deployment identity, result, limitation, and exact rollback target. Health is
reachability only; a journey requires the intended flow and negative behavior.
If a step fails, classify it as transient, source/closure drift, lease/trust,
validation, provider, or data/irreversible. Retry only transient or idempotent
failures, refresh the exact source/closure when safe, roll back to the recorded
incumbent when the objective failure threshold is reached, and leave the lease
and evidence in a terminal fail-closed state.
