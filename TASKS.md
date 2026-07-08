# TASKS

## Priority Backlog

- [ ] Publish the multi-account continuity baseline to the remote repository.
- [ ] Expand the shared project-action surface only through public repo
  scripts, then document each addition.
- [ ] Decide whether the OpenAI workspace will use shared projects as an
  optional operator coordination layer.

## In Progress

- [ ] Move the shared continuity contract into the repository so it no longer
  depends on any single operator's private Codex thread.

## Blocked / Needs Manual Follow-Up

- [ ] Shared Codex threads across separate OpenAI users are not available by
  default, even inside the same Business or Enterprise workspace.
- [ ] Any shared-project or shared-link workflow inside the OpenAI workspace
  depends on workspace features and permissions outside this repository.

## Done

- [x] Define repository-backed continuity files for multi-account handoff:
  `CODEX_CONTEXT.md`, `TASKS.md`, and `DECISIONS.md`.
- [x] Add a public thread bootstrap generator for shared operators.
- [x] Add shared Codex App project actions for status, context, thread
  bootstrap, and worktree creation.
