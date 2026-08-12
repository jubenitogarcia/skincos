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
powershell -ExecutionPolicy Bypass -File .\scripts\manage-canonical-worktrees.ps1 `
  -Action inventory -ProjectRoot (Get-Location).Path
powershell -ExecutionPolicy Bypass -File .\scripts\manage-canonical-worktrees.ps1 `
  -Action plan -ProjectRoot (Get-Location).Path
```

Criar ou reivindicar um slot exige SHA explícito e `-Apply`; não existe
fallback automático para outro worktree:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\manage-canonical-worktrees.ps1 `
  -Action ensure-canonical -SurfaceType crm-module -SurfaceId users `
  -TargetCommit <sha> -ProjectRoot (Get-Location).Path -Apply
powershell -ExecutionPolicy Bypass -File .\scripts\manage-canonical-worktrees.ps1 `
  -Action claim -SurfaceType crm-module -SurfaceId users `
  -ProjectRoot (Get-Location).Path -Apply
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

## Roteamento de novas threads

No primeiro turno, o hook `UserPromptSubmit` entrega o objetivo recebido ao
resolver. Mensagens normais sempre usam intenção `edit`; `preview` e `qualify`
são ações explícitas, jamais inferidas por palavras da mensagem:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\resolve-codex-thread-worktree.ps1 `
  -ProjectRoot (Get-Location).Path `
  -TaskBrief "<objetivo da thread>" `
  -TaskSlug <task-slug> `
  -Intent edit
```

O resolver é somente-leitura. `ready` permite continuar;
`replace/currentThreadAction=create_replacement_thread` orienta a camada nativa
do Codex App a criar uma task substituta; `handoff_other_thread` só autoriza
handoff para uma task diferente, já identificada com segurança.
`manual_registration_required`, `ambiguous` e `blocked` interrompem a escolha
automática. A task chamadora não altera o próprio `cwd`, não faz handoff de si
mesma e o script nunca recebe ou infere `threadId`.

Para preview/qualificação, o slot canônico precisa estar registrado como
projeto no Codex App. O registro de projeto é uma operação do aplicativo, não
um fallback do PowerShell. Para edição, a task substituta usa uma worktree
gerenciada pelo App dentro de
`C:\CodexShared\Worktrees\skincos\admin\managed`, ou uma candidata de tarefa
comprovadamente correspondente. Uma candidata temporária só é comprovada quando
o `TaskSlug` coincide exatamente; o texto do objetivo não seleciona worktrees
existentes por semelhança.

No piloto, registrar manualmente no Codex App estes cinco projetos, usando os
caminhos completos abaixo:

```text
C:\CodexShared\Worktrees\skincos\admin\canonical\crm\users
C:\CodexShared\Worktrees\skincos\admin\canonical\crm\atendimento
C:\CodexShared\Worktrees\skincos\admin\canonical\crm\clientes
C:\CodexShared\Worktrees\skincos\admin\canonical\orb\livia
C:\CodexShared\Worktrees\skincos\admin\canonical\orb\meta-ads-publish
```

Depois do registro, confirme os projetos no Codex App antes de usar preview ou
qualificação e grave a confirmação privada com
`codex-thread-routing-state.ps1 -Action register-native-project`. Se um caminho
não estiver registrado, o resolver retorna `manual_registration_required`; ele
não seleciona outro projeto por nome, proximidade ou histórico da task.

Quando a task precisa ser substituída, o hook reserva antes um nonce privado
com checkout, superfície, SHA e validade curta. A task substituta deve colocar
o marcador emitido na primeira linha do seu primeiro prompt; o vínculo é aceito
somente uma vez, no worktree gerenciado, detached e no SHA esperado. O contexto
transferido contém somente objetivo, restrições, SHA, checkout e decisão do
resolver — nunca IDs de task, cookies ou segredos. A task original é arquivada
somente depois de a substituta estar pronta; exclusão permanente de histórico
não é suportada pela API atual.

## Checklist de encerramento por chat
- Branch/worktree limpos (`git status` sem alteracoes locais).
- PR aberto e rastreavel.
- Merge controlado somente após os gates de segurança e operação estarem documentados no PR.
- Deploy/smoke verificados quando o PR for mergeado.
