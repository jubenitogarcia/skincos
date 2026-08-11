# Multi-Chat Worktree Runbook

## Objetivo
Permitir trabalho paralelo em varios chats/agents sem perder alteracoes e sem conflito de workspace.

## Regras obrigatorias
- Um chat/agent por branch (`codex/...`).
- Um chat/agent por worktree dedicado.
- Nunca compartilhar o mesmo diretorio entre chats ativos.
- Toda sessao termina com `commit + push + PR` (draft ou final).
- Integracao em `main` apenas via PR com checks.

## Fluxo recomendado
1. Criar branch/worktree do chat.
2. Trabalhar apenas no escopo definido.
3. Abrir PR cedo (draft) para checkpoint.
4. Atualizar branch com `origin/main` quando ficar `BEHIND`.
5. Confirmar checks, segurança, rollback e superfícies afetadas antes do merge controlado.
6. Validar deploy/smoke apos merge.

## Comandos padrao
```bash
# 1) Base atualizada
git -C C:/CodexShared/Projetos/skincos fetch origin

# 2) Novo worktree para um chat
powershell -ExecutionPolicy Bypass -File \
  C:/CodexShared/Projetos/skincos/scripts/new-shared-worktree.ps1 \
  -Actor <actor> \
  -TaskSlug <modulo>-<chat> \
  -Fetch

# 3) Publicar checkpoint
cd C:/CodexShared/Worktrees/skincos/<actor>/<modulo>-<chat>
git add -A
git commit -m "wip(<modulo>): checkpoint"
git push -u origin codex/<actor>/<modulo>-<chat>
gh pr create --draft --base main --head codex/<actor>/<modulo>-<chat> --title "WIP <modulo>"

# 4) Se PR ficar BEHIND
git fetch origin
git merge --no-edit origin/main
git push
```

## Convencoes de escopo
- Nome do branch deve refletir operador, modulo e objetivo.
- Evitar dois chats alterando o mesmo arquivo ao mesmo tempo.
- Se precisar do mesmo arquivo, encadear PR (B parte da branch de A) ou serializar.

## Topologia canônica híbrida

O arquivo `ops/codex/worktree-topology.json` define um slot canônico por
superfície CRM do catálogo local, pela exceção explícita `users` e por família
operacional de workflow ORB. Workflows principais e subworkflows são mapeados
na família; subworkflows não recebem slots físicos independentes. O slot
canônico é destinado a preview, qualificação e leitura estável; alterações
continuam em worktrees temporários por tarefa/PR.

Os slots ficam em:

```text
C:\CodexShared\Worktrees\skincos\admin\canonical\crm\<module>
C:\CodexShared\Worktrees\skincos\admin\canonical\orb\<workflow-family>
```

Inventário e plano não alteram Git:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\manage-canonical-worktrees.ps1 -Action inventory
powershell -ExecutionPolicy Bypass -File .\scripts\manage-canonical-worktrees.ps1 -Action plan
```

Criar ou reivindicar um slot exige SHA explícito e `-Apply`; não existe
fallback automático para outro worktree:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\manage-canonical-worktrees.ps1 `
  -Action ensure-canonical -SurfaceType crm-module -SurfaceId users `
  -TargetCommit <sha> -Apply
powershell -ExecutionPolicy Bypass -File .\scripts\manage-canonical-worktrees.ps1 `
  -Action claim -SurfaceType crm-module -SurfaceId users -Apply
```

O estado de owners e leases fica no runtime privado em
`C:\CodexRuntime\operator\admin\skincos\worktree-registry`, nunca no clone
compartilhado. `claim` não substitui branch/PR de uma tarefa.

“Mesclar worktrees” significa integrar commits por PR, merge ou cherry-pick
explícito. Diretórios não são combinados. Worktrees sujos, detached, com PR,
manifesto, processo ou lease permanecem preservados. A aposentadoria usa
somente `git worktree remove` e depois `git worktree prune`.

O ORB continua executando apenas releases imutáveis sob `/opt/skincos`; o
worktree canônico de uma família serve para edição e qualificação e não pode
ser usado como `cwd` de serviço.

## Checklist de encerramento por chat
- Branch/worktree limpos (`git status` sem alteracoes locais).
- PR aberto e rastreavel.
- Merge controlado somente após os gates de segurança e operação estarem documentados no PR.
- Deploy/smoke verificados quando o PR for mergeado.
