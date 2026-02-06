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
5. Habilitar auto-merge quando checks estiverem verdes.
6. Validar deploy/smoke apos merge.

## Comandos padrao
```bash
# 1) Base atualizada
git -C /Users/jubenitogarcia/Automation/skincos fetch origin

# 2) Novo worktree para um chat
git -C /Users/jubenitogarcia/Automation/skincos worktree add \
  /Users/jubenitogarcia/Automation/skincos-<modulo>-<chat> \
  -b codex/<modulo>-<chat> origin/main

# 3) Publicar checkpoint
cd /Users/jubenitogarcia/Automation/skincos-<modulo>-<chat>
git add -A
git commit -m "wip(<modulo>): checkpoint"
git push -u origin codex/<modulo>-<chat>
gh pr create --draft --base main --head codex/<modulo>-<chat> --title "WIP <modulo>"

# 4) Se PR ficar BEHIND
git fetch origin
git merge --no-edit origin/main
git push
```

## Convencoes de escopo
- Nome do branch deve refletir modulo e objetivo.
- Evitar dois chats alterando o mesmo arquivo ao mesmo tempo.
- Se precisar do mesmo arquivo, encadear PR (B parte da branch de A) ou serializar.

## Checklist de encerramento por chat
- Branch/worktree limpos (`git status` sem alteracoes locais).
- PR aberto e rastreavel.
- Auto-merge configurado quando aplicavel.
- Deploy/smoke verificados quando o PR for mergeado.
