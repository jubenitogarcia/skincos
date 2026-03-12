# Proteção de branch (GitHub)

Objetivo: bloquear push direto em `main` e exigir PR com checks verdes.

## Checklist (Settings → Branches → Add rule)

- Branch name pattern: `main`
- Require a pull request before merging
  - Require approvals: `0` (desligado) — para permitir auto-merge sem intervenção humana
  - Dismiss stale approvals: `true` (se aprovações forem habilitadas no futuro)
- Require status checks to pass before merging
  - `CI Smoke (Assert)` (obrigatório)
  - `Central E2E Smoke` (obrigatório)
  - `JS/TS Checks (workspace)` (obrigatório)
  - `Dependency Audit (JS/TS)` (obrigatório)
  - `Scan for secrets (Gitleaks)` (obrigatório)
- Require branches to be up to date before merging: `true`
- Restrict who can push to matching branches: `true`
- Do not allow bypassing the above settings: `true` (enforce_admins)
- Allow force pushes: `false`
- Allow deletions: `false`

## Observações

- Se precisar de aprovações no futuro: usar `CODEOWNERS` + “Require review from Code Owners” e um usuário humano/bot dedicado para reviews.
- Para deploy automático: manter os workflows de deploy disparando apenas após merge em `main` (nunca em PR).
- Para reduzir atrito: habilitar “Auto-merge” e “Automatically delete head branches”.
