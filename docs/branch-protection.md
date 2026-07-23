# Proteção de branch (GitHub)

Objetivo: bloquear push direto em `main` e exigir PR com checks verdes.

## Estado canônico

O contrato versionado está em `.github/governance/main-ruleset.json`. O ruleset ativo `main-enterprise-baseline` deve coexistir temporariamente com a proteção legada até a migração para Organization; ambos mantêm os mesmos checks e bloqueiam force push e exclusão.

## Checklist (Settings → Rules → Rulesets)

- Branch name pattern: `main`
- Require a pull request before merging
  - Require approvals: `0` (desligado) — o operador Codex confirma o gate de merge com evidência no PR
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
- Require conversation resolution: `true`

## Observações

- Depois de criar os times da Organization: usar `CODEOWNERS` + “Require review from Code Owners”, uma aprovação e `require_last_push_approval=true`. Não ativar isso antes: o repositório ainda tem somente um operador elegível.
- Para deploy automático: manter os workflows de deploy disparando apenas após merge em `main` (nunca em PR).
- Auto-merge fica desabilitado. O merge é uma ação controlada após confirmar checks obrigatórios, ausência de vulnerabilidade crítica/alta alcançável, rollback e superfícies afetadas.
