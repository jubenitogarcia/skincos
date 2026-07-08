# Shared Codex workspace for skincos

This repository can be used as the shared Codex workspace at:

- `C:\CodexShared\Projetos\skincos`

The goal of that path is to be the common source of truth for context, review,
planning, and cross-account handoff. It is not the place for secrets, Codex
session databases, or operator-specific auth state.

## Operating rules

- Keep secrets, cookies, `.env`, `.dev.vars`, browser profiles, and private
  `.codex` state out of `C:\CodexShared`.
- The only supported committed `.codex` content is
  `.codex/environments/environment.toml`, so the same project actions appear in
  the shared clone and in derived worktrees.
- Each operator uses their own Codex/OpenAI account, even when all operators
  belong to the same OpenAI Business or Enterprise workspace.
- Do not expect private Codex threads to be visible across operators by
  default. Continuity must come from the repository, worktrees, and handoff
  files.
- Use branches in the format `codex/<windows-user-or-alias>/<task-slug>`.
- Prefer worktrees under
  `C:\CodexShared\Worktrees\skincos\<actor>\<task-slug>` when a task may edit
  code or run in parallel with another operator.
- Keep local Codex state in `%LOCALAPPDATA%\Codex\skincos\`.

## Shared continuity contract

The required continuity files are:

- `CODEX_CONTEXT.md`
- `TASKS.md`
- `DECISIONS.md`

Use them as follows:

- `CODEX_CONTEXT.md`: current machine and repo state that a new operator needs
  before acting.
- `TASKS.md`: backlog, in-progress work, and blocked follow-up.
- `DECISIONS.md`: durable operational or structural decisions that should not
  live only inside a private Codex thread.

If a handoff changes current state, next steps, or a decision, update the
relevant file before ending the task.

## Shared project actions in Codex App

This branch now versions:

- `.codex/environments/environment.toml`

Those actions are intentionally thin wrappers around public repo scripts:

- `Shared Status`
- `Codex Context`
- `Thread Bootstrap`
- `New Worktree`

They must remain relative to the opened project so the same action works in the
shared clone and in any derived worktree.

## Thread bootstrap

When starting a new Codex thread from the shared clone or a worktree, use:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\print-codex-thread-bootstrap.ps1 `
  -TaskSlug review-crm-auth `
  -TaskBrief "Investigate the local CRM auth behavior without editing the shared clone directly."
```

That prompt enforces the shared operating rules, prints the expected branch and
worktree, and lists the validation commands expected before handoff.

## Optional collaboration inside OpenAI workspace

If your OpenAI Business or Enterprise workspace supports shared projects, they
can be used as an optional human coordination layer for:

- summary context,
- links to PRs, branches, and worktrees,
- shared chat links,
- operator checklists.

They must not replace the repository, runtime scripts, or handoff files as the
operational source of truth.
