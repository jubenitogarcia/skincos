# Proteção de branch (GitHub)

Objetivo: bloquear atualizações incompatíveis em `main` e exigir PR com a
autoridade global de integração.

## Checklist (Settings → Branches → Add rule)

- Branch name pattern: `main`
- Require a pull request before merging
  - Require approvals: `0` (desligado) — o operador Codex confirma o gate de merge com evidência no PR
  - Dismiss stale approvals: `true` (se aprovações forem habilitadas no futuro)
- Require status checks to pass before merging
  - `codex-autonomy-gate`
  - `global-merge-authority`
  - `skincos-integration-gate`
- Require branches to be up to date before merging: `true`
- Ruleset: `.github/governance/rulesets/main-enterprise-baseline.json`
  - update rule denies uncoordinated ref updates;
  - only the GitHub Actions integration used by `global-merge-authority` is the
    versioned bypass actor for the update rule;
  - squash is the only allowed merge method;
  - no human or administrator bypass is part of the contract.
- Allow force pushes: `false`
- Allow deletions: `false`

## Observações

- Se precisar de aprovações no futuro: usar `CODEOWNERS` + “Require review from Code Owners” e um usuário humano/bot dedicado para reviews.
- Para deploy automático: manter os workflows de deploy disparando apenas após merge em `main` (nunca em PR).
- Auto-merge não é uma autoridade de integração. Enquanto o repositório não
  tiver uma fila de merge compatível com a ownership global, mantenha-o
  desativado e use somente `global-merge-authority.yml`; a manutenção de PR
  pode atualizar uma branch quando possui `merge:main`, mas não pode integrar
  a PR.
