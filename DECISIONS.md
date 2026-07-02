# DECISIONS

## 2026-07-02 - Shared base lives outside user profiles

- Decision: use `C:\CodexShared` as the shared Codex workspace root.
- Why: avoids per-user profile isolation and avoids using the synced `G:` drive
  as the primary Git collaboration base.
- Impact: shared clones, worktrees, and continuity docs live in a neutral path.

## 2026-07-02 - Keep the original skincos checkout as legacy

- Decision: do not move or rewrite `C:\Users\julia\skincos`.
- Why: the legacy checkout carries local state, caches, and migration residue.
- Impact: new shared collaboration starts from the clean clone only.

## 2026-07-02 - Secrets stay out of the shared area

- Decision: no `.env`, `.dev.vars`, `.codex`, `.cloudflared`, cookies, or
  tokens may be stored under `C:\CodexShared`.
- Why: multiple local Windows users have access to the shared tree.
- Impact: local runtime execution needs a private overlay or private clone.
