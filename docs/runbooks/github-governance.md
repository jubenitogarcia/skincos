# Runbook — governança do repositório GitHub

## Fonte reproduzível

- `CODEOWNERS` e `.github/scripts/validate-github-governance.mjs` definem e verificam a ownership local.
- `.github/governance/rulesets/main-enterprise-baseline.json` é o payload canônico da ruleset da `main`.
- `.github/governance/environments/{staging,production}.json` são os payloads dos environments; segredos não são versionados.

Os arquivos representam a baseline ativa em 2026-07-23: bloqueio de force-push e exclusão, PR obrigatória, resolução de conversas e checks de CI. A aprovação obrigatória por CODEOWNER permanece desativada porque há apenas um owner humano; ativá-la antes de haver um revisor independente bloquearia o desenvolvimento sem aumentar a segregação real.

## Pré-checagem

Execute em uma branch baseada na `main` e com `gh auth status` válido:

```powershell
node .github/scripts/validate-github-governance.mjs
gh api repos/jubenitogarcia/skincos/actions/permissions
gh api repos/jubenitogarcia/skincos/rulesets
gh api repos/jubenitogarcia/skincos/environments
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

Depois, confirme que staging e produção aceitam somente branches protegidas, que secrets têm nomes e valores distintos por environment, e que nenhuma credencial de produção existe em staging. Nunca registre valores de secrets em Git, logs ou PRs.

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
