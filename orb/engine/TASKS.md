# TASKS

## Priority Backlog

- [ ] Reconcile the shared `codex/julia/shared-bootstrap` branch with
  `origin/main` and restore a trusted shared baseline.
- [ ] Run the documented `gh auth login` and shared-only preflight on each new
  Windows account that needs direct live runtime control.
- [ ] Fill the remaining live business env value `GOOGLE_CALENDAR_ID` if and when
  Google Calendar-backed scheduling is meant to run from the live orb runtime.
- [ ] Revalidate the imported `Google Calendar (Skincos)` credential against
  the real scopes needed by the clinic workflows before activation.

## In Progress

- [ ] Multi-account Codex workspace bootstrap on Windows.
- [ ] Shared-machine runtime cutover for n8n in WSL.

## Blocked / Needs Manual Follow-Up

- [ ] Full clinic orb smoke for Google Calendar-backed scheduling remains
  blocked until the Google Calendar binding is proven on the live runtime.

## Done

- [x] Shared n8n workspace embedded in
  `C:\CodexShared\Projetos\skincos\modules\automations\n8n`.
- [x] `AGENTS.md`, `CODEX_CONTEXT.md`, `TASKS.md`, and `DECISIONS.md` established
  for cross-account continuity.
- [x] Shared clone policy set to keep secrets and live runtime state outside
  `C:\CodexShared`.
- [x] Cross-user access validated from a second Windows user without touching
  the live WSL runtime.
- [x] Shared baseline worktree validated for cross-user Git access after
  per-user `safe.directory` bootstrap.
- [x] Shared clone `origin` corrected from a legacy local path to the GitHub
  remote.
- [x] Second Windows user authenticated to GitHub and validated remote
  read/write access with non-destructive dry-runs.
- [x] Shared operational scripts no longer depend on the legacy Windows
  checkout path.
- [x] Guarded WSL shared-runtime preflight/cutover tooling adapted to the
  machine-shared runtime in `C:\CodexRuntime\n8n`.
- [x] Live shared-runtime validation passed for systemd services, local/public
  health endpoints, and SQLite quick check.
- [x] Reusable WSL base tar exported for new Windows accounts.
- [x] Test import of the shared WSL base validated against the shared
  code/runtime model.
- [x] Fresh imported distro bootstrap flow documented with
  `--shared-only --strict-live` validation.
- [x] Legacy Windows checkout `C:\Users\julia\Automation\n8n` removed.
- [x] Legacy WSL runtime paths `/home/julia/Automation`, `/home/julia/.n8n`,
  and `~/.cloudflared` removed.
- [x] Module package commands now separate the shared live runtime path from
  historical user-service and cutover helpers.
- [x] `start-n8n.sh` now defaults its local PID/log/tmp/binary-data state to a
  user-private directory instead of the shared checkout.
- [x] A dedicated business-readiness validator was added for live env bindings
  that are required beyond pure infrastructure health.
- [x] `N8N_DEFAULT_TEST_PHONE` was populated in the shared runtime contract.
