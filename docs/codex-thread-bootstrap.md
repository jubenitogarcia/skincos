# Codex thread bootstrap for shared operators

When an operator opens a new Codex thread against the shared clone or one of
its worktrees, the first prompt should come from:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\print-codex-thread-bootstrap.ps1 `
  -TaskSlug <task-slug> `
  -TaskBrief "<describe the task>"
```

## What the bootstrap must include

Every bootstrap prompt must carry:

- the task objective,
- the normalized task slug,
- the expected `codex/<actor>/<task-slug>` branch,
- the expected worktree path,
- the instruction to treat the shared clone as read-only when edits are needed,
- the instruction to read `AGENTS.md`, `CODEX_CONTEXT.md`, `TASKS.md`, and
  `DECISIONS.md`,
- the expected validation commands for the task,
- the reminder that each operator has a private Codex thread history.

## Why this is required

Operators in the same OpenAI organization still keep separate private Codex
threads. The bootstrap prompt is how the repo supplies consistent operating
context without relying on a prior private thread being visible.

## Example flow

1. Open `C:\CodexShared\Projetos\skincos` in Codex App.
2. Run `Thread Bootstrap`.
3. If the task may edit files, create the suggested worktree.
4. Continue work only inside that worktree.
5. Before handoff, update `CODEX_CONTEXT.md`, `TASKS.md`, and `DECISIONS.md`
   when current state, next steps, or decisions changed.
