# Proteção de branch (GitHub)

Objetivo: bloquear push direto em `main` e exigir PR com checks verdes.

## Checklist (Settings → Branches → Add rule)

- Branch name pattern: `main`
- Require a pull request before merging
  - Require approvals: `1`
  - Dismiss stale approvals: `true`
- Require status checks to pass before merging
  - `CI Smoke (Assert)`
  - `Lint, Format & Static Analysis`
  - `Test Coverage & Quality`
  - `Security Secrets Audit`
- Require branches to be up to date before merging: `true`
- Restrict who can push to matching branches: `true`
- Allow force pushes: `false`
- Allow deletions: `false`

## Observações

- Se usar `CODEOWNERS`, habilitar “Require review from Code Owners”.
- Para deploy automático, manter os workflows de deploy disparando apenas após merge em `main`.
