# Runbook — governança do repositório GitHub

**Atenção:** os payloads e comandos de Actions abaixo documentam o modelo
anterior. GitHub Actions não deve ser iniciado, reexecutado ou aguardado para
novo trabalho. Antes de aplicar uma ruleset, reconciliar o estado live e trocar
checks/atores de Actions por evidência e autoridade independentes, conforme
[`github-actions-retirement.md`](../decisions/github-actions-retirement.md).

## Fonte reproduzível

- `CODEOWNERS` e `.github/scripts/validate-github-governance.mjs` definem e verificam a ownership local.
- `.github/governance/rulesets/main-enterprise-baseline.json` é o payload canônico da ruleset da `main`.
- `.github/governance/environments/{staging,production}.json` são os payloads dos environments; `.github/governance/environments/main-branch-policy.json` é a policy customizada aplicada aos dois environments; segredos não são versionados.

Os arquivos históricos representam a baseline de coordenação global: bloqueio de
force-push e exclusão, PR obrigatória, resolução de conversas, o check
`codex-autonomy-gate`, o `global-merge-authority` e o
`skincos-integration-gate`. O update rule impede mutações diretas de `main` e
o único bypass versionado é o GitHub Actions integration actor da autoridade
de merge. Os checks de domínio continuam executando dentro desse
gate; mudanças que não atingem uma superfície não precisam acordar suítes
globais sem perder a validação proporcional. A aprovação obrigatória por
CODEOWNER permanece desativada porque há apenas um operador autorizado; o
controle equivalente é o gate técnico e a trilha de evidências; auto-merge não
é usado como autoridade concorrente. Os environments de staging e produção usam
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

## Reconciliar ruleset e environments

Antes de qualquer escrita, comparar os payloads versionados com os recursos
remotos. A ruleset versionada antiga contém checks e ator de Actions; não a
reaplicar enquanto não houver payload revisto para a autoridade independente e
prova do gate nativo. Registrar ID, revisão, diff, rollback e readback de cada
recurso alterado. Environments não devem ser atualizados por consequência de
uma revisão apenas da ruleset.

Para Ponto, altere environments somente após comparar a versão e confirmar
que a autorização persistente da missão cobre a alteração. O aceite remoto é
mais estrito que "branch protegida": `deployment_branch_policy` deve usar
custom policies e a listagem deve conter exatamente uma policy `main`;
`can_admins_bypass` deve ser `false`; e a ausência de reviewer não pode ser
reintroduzida por uma cópia histórica. A ausência de qualquer atributo mantém
a release fail-closed. Depois, confirme também que secrets têm a custódia por
environment documentada e que nenhuma credencial de produção existe em
staging. Nunca registre valores de secrets em Git, logs ou PRs.

## Aposentadoria dos workflows

Depois de migrar cada rotina e provar seu substituto, desativar seu gatilho no
GitHub com checkpoint e readback. Não iniciar uma execução de CI para validar
o pin de uma Action antiga. A política de SHA completo continua relevante
apenas enquanto arquivos históricos permanecerem habilitados; não os tratar
como publishers autorizados.

## Revisão periódica

Em cada mudança de workflow, revisar pin, comentário da versão, permissões mínimas, environment usado e caminho de rollback. Mensalmente, comparar ruleset/environments remotos com os arquivos e verificar owners de novos roots. A atualização de SHA ocorre por PR curta, nunca diretamente na `main`.
