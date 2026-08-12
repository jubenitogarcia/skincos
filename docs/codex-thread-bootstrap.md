# Prompt inicial para novas threads no Codex App

Quando você abrir uma nova thread apontando para o projeto compartilhado
`C:\CodexShared\Projetos\skincos`, use a mensagem abaixo como primeira
mensagem para reduzir ruído e fazer o agente cair no fluxo certo.

## Mensagem base

```text
Use este projeto compartilhado em `C:\CodexShared\Projetos\skincos` apenas como base de contexto e coordenação.
Antes de editar qualquer arquivo:
1. Leia `AGENTS.md` e `docs/decisions/codex-autonomy-policy.md`, carregue o snapshot operacional canônico quando existir e inspecione o Git. Somente em missão raiz ou snapshot ausente/desatualizado, reconstrua o contexto e estado remoto necessários; use `CODEX_CONTEXT.md`, `TASKS.md` e `DECISIONS.md` como histórico durável, não como cópias obrigatórias de estado volátil.
2. Verifique o estado compartilhado com `powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\show-shared-codex-status.ps1`.
3. Antes de editar, execute `powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\resolve-codex-thread-worktree.ps1 -ProjectRoot (Get-Location).Path -TaskBrief "<tarefa>" -TaskSlug <task-slug> -Intent edit`.
4. Se o resultado for `ready`, continue na worktree atual. Se for `replace` com `nativeAction=create_thread`, crie uma thread substituta no ambiente nativo `worktree` do Codex App; se for `handoff_thread`, faça handoff somente para outra thread. A thread chamadora não troca seu próprio cwd por PowerShell.
5. Se o resultado for `manual_registration_required`, abra/registre o projeto canônico indicado. `ambiguous` e `blocked` são estados fail-closed; não escolha outra worktree por heurística.
6. Depois de selecionar ou criar a worktree, valide a identidade com `powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\validate-skincos-worktree.ps1 -ProjectRoot (Get-Location).Path -TaskSlug <task-slug> -Mode edit` e trate o clone compartilhado como somente leitura para contexto.
7. Mantenha autenticação, perfis e overrides fora do repositório compartilhado, em `%LOCALAPPDATA%\Codex\skincos\`; logs e artefatos persistentes ficam em `C:\CodexRuntime\operator\admin\skincos\`.
8. Preserve alterações não relacionadas já existentes no projeto compartilhado ou em worktrees de outros usuários. Worktrees sujas, detached, com PR, manifesto, processo ou lease nunca são removidas fisicamente.
9. Execute contexto, testes, builds e scripts de projeto pelo gateway WSL tipado: `powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\invoke-skincos-wsl.ps1 -ProjectRoot (Get-Location).Path -NpmScript codex:context`. Não use `wsl.exe -> bash -lc` nem npm de projeto diretamente no Windows.
10. Antes de concluir, valide proporcionalmente ao efeito, registre snapshot/evidência gerada quando fatos materiais mudarem e não duplique estado volátil em `CODEX_CONTEXT.md`, `TASKS.md` ou `DECISIONS.md`.
11. A missão explícita atual, interpretada pela política de autonomia, mantém sua autorização após compactação, CI, merge e retomada. Não peça novamente autorização já concedida; diferencie autorização de gates técnicos, permissões reais, rollout e rollback.

Tarefa desta thread: <descreva aqui a tarefa>
```

## Gerar automaticamente

Se preferir gerar a mensagem já com o `task-slug` e a descrição:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\print-codex-thread-bootstrap.ps1 `
  -TaskSlug corrigir-site-ef `
  -TaskBrief "Investigar e corrigir o fluxo do Site EF sem trabalhar direto no clone compartilhado."
```

## Quando usar

- Sempre que a thread for aberta a partir do clone compartilhado.
- Principalmente quando a tarefa puder virar edição de código, deploy, QA ou
  investigação mais longa.
- Em tarefas puramente de leitura, a thread pode ficar no clone compartilhado,
  mas ainda vale usar a mesma mensagem para manter o agente alinhado.

## Roteamento automático de worktree

O hook `SessionStart` executa uma validação somente-leitura do checkout atual.
Como o hook não recebe o texto da tarefa, ele apenas registra o estado inicial;
no primeiro turno o agente deve passar o objetivo ao resolver.

O contrato JSON do resolver contém `state`, `surfaceId`, `currentCheckout`,
`recommendedCheckout`, `candidateType`, `targetCommit`, `nativeAction`,
`reasonCodes` e `preservationReasons`. Os estados são:

- `ready`: o checkout atual é elegível;
- `replace`: o Codex App deve criar ou fazer handoff para a candidata indicada;
- `manual_registration_required`: o slot canônico precisa ser aberto como projeto no App;
- `ambiguous`: há mais de uma interpretação ou candidata;
- `blocked`: falta evidência segura ou há proteção ativa.

O script não recebe `threadId`, não cria worktrees, não faz merge e não remove
threads. A camada nativa cria a thread substituta e só arquiva a thread original
depois que a nova estiver pronta. Arquivar é reversível; exclusão permanente
de histórico não faz parte do contrato disponível.

Uma candidata temporária só pode ser associada por `TaskSlug` exato (ou pela
worktree atual já registrada). O texto do objetivo pode resolver a superfície,
mas nunca é usado sozinho para escolher uma worktree existente.
