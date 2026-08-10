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
  - the versioned target includes an `update` rule that denies uncoordinated ref
    updates;
  - only the GitHub Actions integration used by `global-merge-authority` is the
    versioned bypass actor for that rule;
  - squash is the only allowed merge method;
  - no human or administrator bypass is part of the contract.
- Allow force pushes: `false`
- Allow deletions: `false`

## Estado live verificado

Em 2026-08-10, o ruleset ativo `main-enterprise-baseline` (ID `19631459`)
foi lido no GitHub e contém `deletion`, `non_fast_forward`, `pull_request`
com somente `squash` e os três checks obrigatórios. Ele não contém ainda a
regra live `update` nem bypass actors. A tentativa de aplicar a configuração
versionada foi recusada pelo GitHub porque este repositório pessoal não pode
usar a integração GitHub Actions como actor de bypass de ruleset.

Assim, o arquivo versionado é o estado-alvo, não uma afirmação de que a regra
`update` já está ativa. Até a transferência para uma organização ou instalação
de uma GitHub App/integração que o GitHub aceite como owner do ruleset, a única
autoridade suportada para integrar `main` continua sendo
`global-merge-authority.yml`, protegida pelos checks obrigatórios e pela
revalidação do lease. Não adicionar bypass humano para compensar a limitação.
Depois de provisionar a autoridade compatível, reaplicar o ruleset completo e
confirmar o readback antes de remover este blocker.

## Observações

- Se precisar de aprovações no futuro: usar `CODEOWNERS` + “Require review from Code Owners” e um usuário humano/bot dedicado para reviews.
- Para deploy automático: manter os workflows de deploy disparando apenas após merge em `main` (nunca em PR).
- Auto-merge não é uma autoridade de integração. Enquanto o repositório não
  tiver uma fila de merge compatível com a ownership global, mantenha-o
  desativado e use somente `global-merge-authority.yml`; a manutenção de PR
  pode atualizar uma branch quando possui `merge:main`, mas não pode integrar
  a PR.
