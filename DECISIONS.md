# DECISIONS

## 2026-07-08 - Treat the repository as the continuity contract between Codex operators

- Decision: use `CODEX_CONTEXT.md`, `TASKS.md`, and `DECISIONS.md` as the
  required handoff surface between operators on the shared mini-PC.
- Why: each Windows operator may use a different Codex/OpenAI account, and
  private Codex threads are not assumed to be visible across those accounts.
- Impact: any task that changes current state, next steps, or operational
  decisions must update the relevant continuity file before handoff.

## 2026-07-08 - Keep Codex App sharing limited to project actions

- Decision: allow only `.codex/environments/environment.toml` to be committed
  for Codex App integration in the shared repo.
- Why: project actions should be shared, but private Codex auth, caches,
  session history, and local state must remain per operator.
- Impact: the same top-bar actions can appear in the shared clone and in
  worktrees without attempting to share private `.codex` state.

## 2026-07-08 - Require bootstrap prompts for new shared threads

- Decision: new Codex threads that start from the shared clone or from a
  worktree must use `scripts/print-codex-thread-bootstrap.ps1`.
- Why: the bootstrap prompt is the consistent way to inject task slug, expected
  branch/worktree, validation commands, and continuity rules into a new private
  thread.
- Impact: an operator should not consider a new thread ready for multi-account
  handoff until that bootstrap context has been applied.

## 2026-07-08 - Treat OpenAI workspace collaboration as optional, not operational

- Decision: shared OpenAI projects and shared chat links may be used for human
  coordination, but they are not part of the technical source of truth.
- Why: workspace collaboration features can help people coordinate, but the
  mini-PC must remain operable from the repository, worktrees, and public
  scripts alone.
- Impact: repository state remains authoritative even when OpenAI workspace
  collaboration features are available.
