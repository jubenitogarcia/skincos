# CODEX_CONTEXT

## Current State

- The shared collaboration path for this machine is
  `C:\CodexShared\Projetos\skincos`.
- Dedicated worktrees should live under
  `C:\CodexShared\Worktrees\skincos\<user>\<task-slug>`.
- This repository still uses the current canonical roots in `backend/`,
  `frontend/`, `modules/site-public/website/`, `n8n/`, `ops/`, `docs/`, and `scripts/`.
- Operators may use different Codex/OpenAI accounts while remaining inside the
  same OpenAI Business or Enterprise workspace.
- Private Codex thread history is not assumed to be shared automatically across
  those operators.
- The supported continuity contract for operators is now versioned in:
  `AGENTS.md`, `CODEX_CONTEXT.md`, `TASKS.md`, and `DECISIONS.md`.
- Shared Codex App project actions are now versioned through
  `.codex/environments/environment.toml`.
- The public repo entrypoints for cross-account continuity are:
  `scripts/show-shared-codex-status.ps1`,
  `scripts/print-codex-thread-bootstrap.ps1`,
  `scripts/new-shared-worktree.ps1`, and
  `scripts/run-shared-codex-shortcut.ps1`.

## Operational Model

- Treat the shared clone as the cross-account source of truth for context and
  coordination.
- Treat a dedicated worktree as the only place to perform implementation work
  when a task may edit files or overlap with another operator.
- Keep local Codex state, browser state, temp files, and auth state outside the
  shared repo in `%LOCALAPPDATA%\Codex\skincos\`.
- Use the continuity files instead of relying on another operator's private
  Codex thread to be visible.

## Known Constraints

- The OpenAI workspace can improve human collaboration, but it does not replace
  repository-backed handoff.
- Shared OpenAI projects or shared links are optional coordination aids only.
- No shared operator flow should depend on copying `.codex` state between
  Windows profiles.

## Next Recommended Steps

- Publish this multi-account baseline so future operators bootstrap from a
  tracked remote branch instead of a local-only state.
- Expand the shared project actions only through public repo scripts, then
  document each new action in the shared workspace docs.
- Keep `TASKS.md` and `DECISIONS.md` current whenever the multi-account model
  changes.
