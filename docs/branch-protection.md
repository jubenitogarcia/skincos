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
  segue o gate proporcional à superfície: docs não acordam suítes pesadas,
  código comum usa um foco, e somente mudanças elevadas/excepcionais exigem
  segurança/rollback adicional; a habilitação não contorna a ruleset.
- O único gatilho obrigatório de PR é o `codex-autonomy-gate`. Ele calcula um
  plano versionado em `scripts/github-actions/validation-plan.mjs` e chama os
  componentes reutilizáveis apenas quando suas superfícies são afetadas. Assim,
  os nomes de checks de release (`CI Smoke (Assert)`, `Central E2E Smoke`,
  `JS/TS Checks (workspace)`, `Scan for secrets (Gitleaks)` e
  `Dependency Audit (JS/TS)`) continuam existindo nos fluxos que os exigem,
  sem iniciar cópias independentes em todo PR.
- Alterações desconhecidas que não sejam exclusivamente documentação falham
  para o conjunto central conservador. A concorrência do gate cancela apenas a
  execução obsoleta do mesmo PR/ref, nunca uma execução de outro PR.
