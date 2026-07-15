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

## Checklist de encerramento por chat
- Branch/worktree limpos (`git status` sem alteracoes locais).
- PR aberto e rastreavel.
- Merge controlado somente após os gates de segurança e operação estarem documentados no PR.
- Deploy/smoke verificados quando o PR for mergeado.
