# Mini-PC multi-account autonomy

Official model for the skincos mini-PC:

- shared code base: `C:\CodexShared\Projetos\skincos`
- shared worktrees: `C:\CodexShared\Worktrees\skincos\<user>\<task-slug>`
- private Codex local state: `%LOCALAPPDATA%\Codex\skincos\`
- shared Codex project actions: `.codex/environments/environment.toml`
- shared continuity files: `CODEX_CONTEXT.md`, `TASKS.md`, `DECISIONS.md`

## Identity model

- Each Windows account may use a different Codex/OpenAI user.
- Those operators can still belong to the same OpenAI Business or Enterprise
  workspace.
- That workspace does not make private Codex threads automatically visible to
  other operators.
- Therefore the mini-PC must treat repository state, worktrees, and continuity
  files as the supported handoff mechanism.

## Minimum per-account bootstrap

For each Windows account:

1. Register the shared clone as a Git `safe.directory`.
2. Open the shared clone in Codex App manually.
3. Use the shared project actions from `.codex/environments/environment.toml`.
4. Keep local state in `%LOCALAPPDATA%\Codex\skincos\`.
5. Use a dedicated worktree for any task that may edit files or run in
   parallel.

## Supported operator workflow

1. Read `AGENTS.md`, `CODEX_CONTEXT.md`, `TASKS.md`, and `DECISIONS.md`.
2. Run `Shared Status`.
3. Run `Thread Bootstrap`.
4. If the task may edit code, create a worktree and reopen that worktree in
   Codex App.
5. Work only inside the worktree.
6. Before handoff, update the continuity files.

## Optional OpenAI workspace collaboration

If shared projects are available in your OpenAI workspace, use them only as an
optional coordination layer for:

- shared links,
- links to PRs and worktrees,
- human checklists,
- summary context.

Do not depend on those workspace features for the technical operation of the
mini-PC.
