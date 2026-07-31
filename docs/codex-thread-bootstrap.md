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
3. Se a tarefa não for estritamente de leitura, crie um worktree dedicado com `powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\new-shared-worktree.ps1 -TaskSlug <task-slug> -Fetch`.
4. Depois de criar o worktree, trabalhe apenas nele e trate o clone compartilhado como somente leitura para contexto.
5. Mantenha autenticação, perfis e overrides fora do repositório compartilhado, em `%LOCALAPPDATA%\Codex\skincos\`; logs e artefatos persistentes ficam em `C:\CodexRuntime\operator\admin\skincos\`.
6. Preserve alterações não relacionadas já existentes no projeto compartilhado ou em worktrees de outros usuários.
7. Execute contexto, testes, builds e scripts de projeto pelo gateway WSL tipado: `powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\invoke-skincos-wsl.ps1 -ProjectRoot (Get-Location).Path -NpmScript codex:context`. Não use `wsl.exe -> bash -lc` nem npm de projeto diretamente no Windows.
8. Antes de concluir, valide proporcionalmente ao efeito, registre snapshot/evidência gerada quando fatos materiais mudarem e não duplique estado volátil em `CODEX_CONTEXT.md`, `TASKS.md` ou `DECISIONS.md`.
9. A missão explícita atual, interpretada pela política de autonomia, mantém sua autorização após compactação, CI, merge e retomada. Não peça novamente autorização já concedida; diferencie autorização de gates técnicos, permissões reais, rollout e rollback.

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
