# Runbook — governança do repositório GitHub

## Fonte reproduzível

- `CODEOWNERS` e `.github/scripts/validate-github-governance.mjs` definem e verificam a ownership local.
- `.github/governance/rulesets/main-enterprise-baseline.json` é o payload canônico da ruleset da `main`.
- `.github/governance/environments/{staging,production}.json` são os payloads dos environments; `.github/governance/environments/main-branch-policy.json` é a policy customizada aplicada aos dois environments; segredos não são versionados.

Os arquivos representam a baseline efetiva reconciliada em 2026-07-30:
bloqueio de force-push e exclusão, PR obrigatória, resolução de conversas,
checks de CI e proteção dos environments por review e policy customizada da
`main`.
A aprovação obrigatória por CODEOWNER permanece desativada porque há apenas um
owner humano; ativá-la antes de haver um revisor independente bloquearia o
desenvolvimento sem aumentar a segregação real. O único reviewer atualmente
versionado é o próprio owner com `prevent_self_review=true`: isso reproduz o
estado remoto e mantém staging/produção deliberadamente fail-closed, mas não
constitui aprovação independente. A designação de um reviewer humano ou app
independente deve atualizar o estado remoto e estes payloads na mesma mudança
revisada.

## Pré-checagem

Execute em uma branch baseada na `main` e com `gh auth status` válido:

```powershell
node .github/scripts/validate-github-governance.mjs
gh api repos/jubenitogarcia/skincos/actions/permissions
gh api repos/jubenitogarcia/skincos/rulesets
gh api repos/jubenitogarcia/skincos/environments
gh api repos/jubenitogarcia/skincos/environments/staging
gh api "repos/jubenitogarcia/skincos/environments/staging/deployment-branch-policies?per_page=100"
gh api repos/jubenitogarcia/skincos/environments/production
gh api "repos/jubenitogarcia/skincos/environments/production/deployment-branch-policies?per_page=100"
```

Todo `uses:` externo deve apontar para SHA completo de 40 caracteres. Referências locais (`./`) são permitidas. Tags, branches e SHAs curtos bloqueiam CI e não podem ser promovidos à `main`.

## Aplicar ruleset e environments

Use somente após comparar o estado remoto com os arquivos versionados. Para atualizar a ruleset existente, obtenha o ID pelo nome e faça `PUT`; para criar, use `POST` uma única vez.

```powershell
$ruleset = gh api repos/jubenitogarcia/skincos/rulesets | ConvertFrom-Json | Where-Object name -eq 'main-enterprise-baseline'
gh api --method PUT "repos/jubenitogarcia/skincos/rulesets/$($ruleset.id)" --input .github/governance/rulesets/main-enterprise-baseline.json
gh api --method PUT repos/jubenitogarcia/skincos/environments/staging --input .github/governance/environments/staging.json
gh api --method PUT repos/jubenitogarcia/skincos/environments/production --input .github/governance/environments/production.json
```

O `PUT` configura o modo customizado, mas a API de environments administra as
branch policies por endpoint próprio. Depois do `PUT`, consulte a lista e só
crie a policy versionada quando a lista estiver vazia; qualquer outra
divergência deve interromper a operação para reconciliação, sem excluir policies
desconhecidas automaticamente:

```powershell
$repo = 'repos/jubenitogarcia/skincos'
$policy = Get-Content .github/governance/environments/main-branch-policy.json -Raw
foreach ($environment in @('staging', 'production')) {
  $route = "$repo/environments/$environment/deployment-branch-policies"
  $current = gh api "$route?per_page=100" | ConvertFrom-Json
  if ($current.total_count -eq 0) {
    $policy | gh api --method POST $route --input -
  } elseif ($current.total_count -ne 1 -or $current.branch_policies[0].name -ne 'main' -or $current.branch_policies[0].type -ne 'branch') {
    throw "deployment branch policy drift in $environment"
  }
}
```

Para Ponto, o aceite remoto é mais estrito que a existência do payload:
`can_admins_bypass` deve ser `false`; a listagem deve conter exatamente a policy
`main`; e a regra `required_reviewers` deve conter um reviewer independente com
`prevent_self_review=true`. Enquanto houver apenas o owner impedido de
autoaprovar, a release permanece corretamente fail-closed. Depois, confirme
também que secrets têm custódia por environment documentada e que nenhuma
credencial de produção existe em staging. Nunca registre valores de secrets em
Git, logs ou PRs.

## Exigir SHA completo para Actions

Ative somente depois de uma PR com o validador verde e todos os workflows de `main` compatíveis. Preserve as permissões existentes ao atualizar o campo:

```powershell
$permissions = gh api repos/jubenitogarcia/skincos/actions/permissions | ConvertFrom-Json
$body = @{ enabled = $permissions.enabled; allowed_actions = $permissions.allowed_actions; sha_pinning_required = $true } | ConvertTo-Json -Compress
$body | gh api --method PUT repos/jubenitogarcia/skincos/actions/permissions --input -
gh api repos/jubenitogarcia/skincos/actions/permissions
```

Aceite: `sha_pinning_required` é `true`; uma execução de CI da `main` inicia sem erro de resolução de Action; o validador continua verde. Rollback: repetir o comando com `sha_pinning_required = $false` somente para restaurar a execução e abrir uma PR corretiva imediata que repine a referência ofensora.

## Revisão periódica

Em cada mudança de workflow, revisar pin, comentário da versão, permissões mínimas, environment usado e caminho de rollback. Mensalmente, comparar ruleset/environments remotos com os arquivos e verificar owners de novos roots. A atualização de SHA ocorre por PR curta, nunca diretamente na `main`.
