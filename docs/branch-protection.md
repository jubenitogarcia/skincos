# Proteção de branch (GitHub)

Objetivo: bloquear push direto em `main` e exigir PR com o gate agregado verde.

## Checklist (Settings → Branches → Add rule)

- Branch name pattern: `main`
- Require a pull request before merging
  - Require approvals: `0` (desligado) — o operador Codex confirma o gate de merge com evidência no PR
  - Dismiss stale approvals: `true` (se aprovações forem habilitadas no futuro)
- Require status checks to pass before merging
  - `codex-autonomy-gate` (obrigatório; agrega apenas as validações
    proporcionais às superfícies alteradas)
- Require branches to be up to date before merging: `true`
- Restrict who can push to matching branches: `true`
- Do not allow bypassing the above settings: `true` (enforce_admins)
- Allow force pushes: `false`
- Allow deletions: `false`

## Observações

- Se precisar de aprovações no futuro: usar `CODEOWNERS` + “Require review from Code Owners” e um usuário humano/bot dedicado para reviews.
- Para deploy automático: manter os workflows de deploy disparando apenas após merge em `main` (nunca em PR).
- Auto-merge pode ser habilitado pelo workflow de manutenção somente quando o PR
  não é draft, está limpo e todos os checks obrigatórios estão verdes. O merge
  continua condicionado à ausência de vulnerabilidade crítica/alta alcançável,
  rollback e superfícies afetadas; a habilitação não contorna a ruleset.
