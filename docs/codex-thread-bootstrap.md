# Prompt inicial para novas threads no Codex App

Quando você abrir uma nova thread apontando para o projeto compartilhado
`C:\CodexShared\Projetos\skincos`, use a mensagem abaixo como primeira
mensagem para reduzir ruído e fazer o agente cair no fluxo certo.

## Mensagem base

```text
Use este projeto compartilhado em `C:\CodexShared\Projetos\skincos` apenas como base de contexto e coordenação.
Antes de editar qualquer arquivo:
1. Leia `AGENTS.md`, `CODEX_CONTEXT.md`, `TASKS.md` e `DECISIONS.md`.
2. Verifique o estado compartilhado com `powershell -ExecutionPolicy Bypass -File .\scripts\show-shared-codex-status.ps1`.
3. Se a tarefa não for estritamente de leitura, crie um worktree dedicado com `powershell -ExecutionPolicy Bypass -File .\scripts\new-shared-worktree.ps1 -TaskSlug <task-slug> -Fetch`.
4. Depois de criar o worktree, trabalhe apenas nele e trate o clone compartilhado como somente leitura para contexto.
5. Mantenha estado local, logs, perfis e overrides fora do repositório compartilhado, em `%LOCALAPPDATA%\Codex\skincos\`.
6. Preserve alterações não relacionadas já existentes no projeto compartilhado ou em worktrees de outros usuários.
7. Antes de concluir, valide o que mudar e registre contexto relevante em `CODEX_CONTEXT.md`, `TASKS.md` e `DECISIONS.md` quando fizer sentido.

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
