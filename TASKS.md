# TASKS

## Priority Backlog

- [ ] Validate cross-user access to `C:\CodexShared\Projetos\skincos`.
- [ ] Validate that a second Codex account can open this shared clone and follow
  the continuity files without touching the legacy checkout.
- [ ] Define the first shared worktree naming pattern for each active operator.
- [ ] Audit remaining operator-specific paths or local assumptions before using
  the shared clone for deploy-related work.

## In Progress

- [ ] Multi-account Codex workspace bootstrap on Windows.

## Blocked / Needs Manual Follow-Up

- [ ] Any task that requires real `.env`, `.dev.vars`, `.cloudflared`, or API
  credentials must use a private overlay outside `C:\CodexShared`.

## Done

- [x] Shared clone created in `C:\CodexShared\Projetos\skincos`.
- [x] `AGENTS.md`, `CODEX_CONTEXT.md`, `TASKS.md`, and `DECISIONS.md` established
  for cross-account continuity.
- [x] Operator-specific `cloudflared` credential paths replaced with documented
  placeholders in the shared clone.
