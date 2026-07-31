# Runbook — governança do repositório GitHub

## Fonte reproduzível

- `CODEOWNERS` e `.github/scripts/validate-github-governance.mjs` definem e verificam a ownership local.
- `.github/governance/rulesets/main-enterprise-baseline.json` é o payload canônico da ruleset da `main`.
- `.github/governance/environments/{staging,production}.json` são os payloads dos environments; `.github/governance/environments/main-branch-policy.json` é a policy customizada aplicada aos dois environments; segredos não são versionados.

Os arquivos representam a baseline de 2026-07-31: bloqueio de force-push e
exclusão, PR obrigatória, resolução de conversas e o check agregado
`codex-autonomy-gate`. Os checks de domínio continuam executando dentro desse
gate; mudanças que não atingem uma superfície não precisam acordar suítes
globais sem perder a validação proporcional. A aprovação obrigatória por
CODEOWNER permanece desativada porque há apenas um operador autorizado; o
controle equivalente é o gate técnico, a trilha de evidências e o auto-merge
condicionado a checks verdes. Os environments de staging e produção usam
`reviewers: []`, `prevent_self_review: false`, `can_admins_bypass: false` e
política de branch customizada somente para `main`, conforme a governança de
operador único registrada no issue #943.

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

Para Ponto, execute os dois `PUT` somente após comparar a versão e confirmar
que a autorização persistente da missão cobre a alteração. O aceite remoto é
mais estrito que "branch protegida": `deployment_branch_policy` deve usar
custom policies e a listagem deve conter exatamente uma policy `main`;
`can_admins_bypass` deve ser `false`; e a ausência de reviewer não pode ser
reintroduzida por uma cópia histórica. A ausência de qualquer atributo mantém
a release fail-closed. Depois, confirme também que secrets têm a custódia por
environment documentada e que nenhuma credencial de produção existe em
staging. Nunca registre valores de secrets em Git, logs ou PRs.

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
