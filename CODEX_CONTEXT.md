# CODEX_CONTEXT

## Current State

- Shared multi-account clone created at `C:\CodexShared\Projetos\skincos`.
- Legacy operator checkout remains at `C:\Users\julia\skincos` and is not part of
  the shared continuity flow.
- Main surfaces in this repository are `website/`, `frontend/`, `backend/`, and
  supporting Cloudflare, GitHub Actions, and automation scripts.
- Shared clone starts clean on `main` from commit `aeacbab2`.

## Operational Model

- Use this clone for shared context, code review, task planning, branch/worktree
  coordination, and clean implementation starts.
- Keep secrets outside `C:\CodexShared`. Local execution that needs `.env` or
  `.dev.vars` must use a private overlay or private clone per operator.
- When work spans multiple accounts, document progress here and update
  `TASKS.md` and `DECISIONS.md` before handing off.

## Known Constraints

- Existing production and migration-sensitive flows include Cloudflare Pages,
  Workers, D1, CRM, and tracking modules.
- Some historical configs referenced operator-specific `cloudflared`
  credential paths; the shared clone now uses documented placeholders instead.
- The legacy checkout may remain dirty and should not be treated as the shared
  collaboration base.

## Next Recommended Steps

- Validate that another Windows user can open this clone and read the context
  files without needing the original profile.
- Create per-task worktrees under `C:\CodexShared\Worktrees\skincos\...`.
- If a task needs local runtime secrets, keep them outside the shared tree and
  document only the variable names and expected source.
